import { Request, Response, NextFunction } from 'express';
import pool from '../config/db';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';
import { PoolClient } from 'pg'; // Import PoolClient for type safety

interface AuthRequest extends Request {
  user?: {
    id: number;
    user_type: string;
  };
  file?: Express.Multer.File; // This comes from multer middleware
}

// Get user profile
export const getProfile = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
        return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

    // Get user data
    const userResult = await pool.query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.user_type, u.created_at,
              up.job_title, up.location, up.profile_image_url, up.profile_summary,
              up.professional_summary, up.years_of_experience, up.experience_level,
              up.primary_industry, up.profile_completion, up.website_url, up.linkedin_url, up.github_url
       FROM users u
       LEFT JOIN user_profiles up ON u.id = up.user_id
       WHERE u.id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      data: userResult.rows[0]
    });
  } catch (error) {
    logger.error('Get profile error:', error);
    next(error);
  }
};

// Update user profile
export const updateProfile = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    const file = req.file; // Get the uploaded file from multer

    if (!userId) {
        return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

    const {
      first_name,
      last_name,
      job_title,
      location,
      profile_summary,
      professional_summary,
      years_of_experience,
      experience_level,
      primary_industry,
      website_url,
      linkedin_url,
      github_url
    } = req.body;

    let newProfileImageUrl: string | null = null;

    // Start a transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // --- START: Profile Image Handling ---
      let oldProfileImageUrl: string | null = null;
      if (file) {
        // Get the current profile image URL to delete the old file later
        const currentProfileResult = await client.query(
          `SELECT profile_image_url FROM user_profiles WHERE user_id = $1`,
          [userId]
        );
        if (currentProfileResult.rows.length > 0) {
          oldProfileImageUrl = currentProfileResult.rows[0].profile_image_url;
        }

        // Construct the URL for the new image (adjust path as needed)
        // Ensure the 'uploads' directory exists and is served statically by Express
        newProfileImageUrl = `/uploads/${file.filename}`;
        logger.info(`New profile image URL for user ${userId}: ${newProfileImageUrl}`);
      }
      // --- END: Profile Image Handling ---

      // Update user table (first_name, last_name)
      if (first_name || last_name) {
        await client.query(
          `UPDATE users
           SET first_name = COALESCE($1, first_name),
               last_name = COALESCE($2, last_name)
           WHERE id = $3`,
          [first_name, last_name, userId]
        );
        logger.info(`Updated name for user ${userId}`);
      }

      // Update profile table (including the new image URL if uploaded)
      // Use COALESCE for text fields, but directly set image URL if new one exists
      const profileUpdateQuery = `
        UPDATE user_profiles
        SET job_title = COALESCE($1, job_title),
            location = COALESCE($2, location),
            profile_summary = COALESCE($3, profile_summary),
            professional_summary = COALESCE($4, professional_summary),
            years_of_experience = COALESCE($5, years_of_experience),
            experience_level = COALESCE($6, experience_level),
            primary_industry = COALESCE($7, primary_industry),
            website_url = COALESCE($8, website_url),
            linkedin_url = COALESCE($9, linkedin_url),
            github_url = COALESCE($10, github_url),
            profile_image_url = $11 -- Use the new URL directly
        WHERE user_id = $12`;

      // Determine the final image URL to save
      const finalImageUrl = newProfileImageUrl ?? oldProfileImageUrl; // Use new if exists, else keep old

      await client.query(profileUpdateQuery, [
        job_title,
        location,
        profile_summary,
        professional_summary,
        years_of_experience,
        experience_level,
        primary_industry,
        website_url,
        linkedin_url,
        github_url,
        finalImageUrl // Use the determined final URL
      ]);
      logger.info(`Updated profile details for user ${userId}`);


      // --- START: Delete Old Profile Image File ---
      // Delete only if a new image was uploaded AND the old image existed AND they are different
      if (newProfileImageUrl && oldProfileImageUrl && newProfileImageUrl !== oldProfileImageUrl) {
        // Construct the absolute path to the old file
        // Assumes 'uploads' is directly inside the project root. Adjust if needed.
        const oldFilePath = path.join(__dirname, '../../uploads', path.basename(oldProfileImageUrl));
        try {
          if (fs.existsSync(oldFilePath)) {
            fs.unlinkSync(oldFilePath);
            logger.info(`Deleted old profile image: ${oldFilePath}`);
          } else {
            logger.warn(`Old profile image not found, skipping deletion: ${oldFilePath}`);
          }
        } catch (unlinkError) {
          logger.error(`Error deleting old profile image ${oldFilePath}:`, unlinkError);
          // Don't fail the whole request, just log the error
        }
      }
      // --- END: Delete Old Profile Image File ---


      // Calculate and update profile completion percentage (using helper function)
      await updateProfileCompletion(userId, client); // Pass client for transaction

      await client.query('COMMIT');
      logger.info(`Profile update committed for user ${userId}`);

      // Get updated profile to return
      const updatedProfile = await pool.query(
        `SELECT u.id, u.first_name, u.last_name, u.email, u.user_type,
                up.job_title, up.location, up.profile_image_url, up.profile_summary, up.professional_summary,
                up.years_of_experience, up.experience_level, up.primary_industry,
                up.profile_completion, up.website_url, up.linkedin_url, up.github_url
         FROM users u
         LEFT JOIN user_profiles up ON u.id = up.user_id
         WHERE u.id = $1`,
        [userId]
      );

      res.status(200).json({
        success: true,
        data: updatedProfile.rows[0]
      });
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error(`Profile update rolled back for user ${userId} due to error:`, error);
      // If an image was uploaded during the failed transaction, delete it
      if (newProfileImageUrl) {
          const newFilePath = path.join(__dirname, '../../uploads', path.basename(newProfileImageUrl));
          try {
              if (fs.existsSync(newFilePath)) {
                  fs.unlinkSync(newFilePath);
                  logger.info(`Deleted orphaned profile image after rollback: ${newFilePath}`);
              }
          } catch (unlinkError) {
              logger.error(`Error deleting orphaned profile image ${newFilePath} after rollback:`, unlinkError);
          }
      }
      throw error; // Let the main error handler catch this
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Update profile main error handler:', error);
    next(error);
  }
};

// Get user's resumes
export const getResumes = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
     if (!userId) {
        return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

    const result = await pool.query(
      `SELECT id, file_name, storage_url, file_size_kb, is_default_resume, uploaded_at
       FROM user_documents
       WHERE user_id = $1 AND document_type = 'resume'
       ORDER BY uploaded_at DESC`,
      [userId]
    );

    res.status(200).json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    logger.error('Get resumes error:', error);
    next(error);
  }
};

// Upload resume
export const uploadResume = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    const file = req.file;
     if (!userId) {
        return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

    if (!file) {
      return res.status(400).json({
        success: false,
        error: 'Please upload a file'
      });
    }

    // --- Transaction for setting default resume ---
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Construct the storage URL (relative path for client access)
        const storageUrl = `/uploads/${file.filename}`;

        // Save file details to database
        const result = await client.query(
          `INSERT INTO user_documents
           (user_id, document_type, file_name, storage_url, file_size_kb, is_default_resume)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [
            userId,
            'resume',
            file.originalname,
            storageUrl,
            Math.round(file.size / 1024),
            true // Make this the default resume initially
          ]
        );

        const newResume = result.rows[0];

        // If this is set as default, unset other default resumes for this user
        await client.query(
          `UPDATE user_documents
           SET is_default_resume = FALSE
           WHERE user_id = $1 AND id != $2 AND document_type = 'resume'`,
          [userId, newResume.id]
        );

        await client.query('COMMIT');
        logger.info(`Resume ${newResume.id} uploaded and set as default for user ${userId}`);

        // Update profile completion after commit
        await updateProfileCompletion(userId);

        res.status(201).json({
          success: true,
          data: newResume
        });

    } catch (error) {
        await client.query('ROLLBACK');
        logger.error(`Resume upload rolled back for user ${userId} due to error:`, error);
        // If rollback happens, try to delete the uploaded file
        if (file) {
            // Construct absolute path for deletion
            const filePath = path.join(__dirname, '../../uploads', file.filename);
             try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    logger.info(`Deleted orphaned resume file after DB error: ${filePath}`);
                }
            } catch (unlinkError) {
                logger.error(`Error deleting orphaned resume file ${filePath}:`, unlinkError);
            }
        }
        throw error; // Re-throw the original error
    } finally {
        client.release();
    }
  } catch (error) {
    logger.error('Upload resume error:', error);
    next(error);
  }
};

// Delete resume
export const deleteResume = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    const resumeId = parseInt(req.params.id, 10); // Parse ID from URL param
     if (!userId) {
        return res.status(401).json({ success: false, error: 'User not authenticated' });
    }
     if (isNaN(resumeId)) {
        return res.status(400).json({ success: false, error: 'Invalid Resume ID format' });
    }

    // Get resume info for file deletion
    const fileResult = await pool.query(
      `SELECT id, storage_url FROM user_documents
       WHERE id = $1 AND user_id = $2 AND document_type = 'resume'`,
      [resumeId, userId]
    );

    if (fileResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Resume not found or not authorized'
      });
    }

    const fileRecord = fileResult.rows[0];

    // Delete from database
    const deleteResult = await pool.query(
      `DELETE FROM user_documents
       WHERE id = $1 AND user_id = $2`,
      [resumeId, userId]
    );

    if (deleteResult.rowCount === 0) {
        // Should not happen due to the check above, but good practice
        logger.warn(`Attempted to delete resume ${resumeId} for user ${userId}, but no rows affected.`);
        return res.status(404).json({ success: false, error: 'Resume not found during deletion attempt.' });
    }

    logger.info(`Deleted resume record ${resumeId} for user ${userId} from database.`);

    // Delete file from storage
    // Construct absolute path from relative storage_url
    const filePath = path.join(__dirname, '../../', fileRecord.storage_url);
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            logger.info(`Deleted resume file from storage: ${filePath}`);
        } else {
             logger.warn(`Resume file not found in storage, skipping deletion: ${filePath}`);
        }
    } catch (unlinkError) {
        logger.error(`Error deleting resume file ${filePath} from storage:`, unlinkError);
        // Log error but continue, DB record is already deleted
    }

    // Update profile completion
    await updateProfileCompletion(userId);

    res.status(200).json({
      success: true,
      data: {} // Indicate successful deletion
    });
  } catch (error) {
    logger.error('Delete resume error:', error);
    next(error);
  }
};


// Get user skills
export const getSkills = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
     if (!userId) {
        return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

    const result = await pool.query(
      `SELECT us.id, s.id as skill_id, s.name, s.category, us.proficiency_level
       FROM user_skills us
       JOIN skills s ON us.skill_id = s.id
       WHERE us.user_id = $1
       ORDER BY s.name`,
      [userId]
    );

    res.status(200).json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    logger.error('Get skills error:', error);
    next(error);
  }
};

// Add a skill to user profile
export const addSkill = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
       if (!userId) {
        return res.status(401).json({ success: false, error: 'User not authenticated' });
    }
      const { skillId, proficiencyLevel } = req.body;

      if (!skillId) {
          return res.status(400).json({ success: false, error: 'Skill ID is required' });
      }
      const parsedSkillId = parseInt(skillId, 10);
      if (isNaN(parsedSkillId)) {
          return res.status(400).json({ success: false, error: 'Invalid Skill ID format' });
      }

      // Check if skill exists
      const skillResult = await pool.query(
        'SELECT id FROM skills WHERE id = $1',
        [parsedSkillId]
      );

      if (skillResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Skill not found'
        });
      }

      // Check if user already has this skill
      const existingSkill = await pool.query(
        'SELECT id FROM user_skills WHERE user_id = $1 AND skill_id = $2',
        [userId, parsedSkillId]
      );

      if (existingSkill.rows.length > 0) {
        // Optionally update proficiency instead of erroring?
        // For now, return error as per original logic
        return res.status(400).json({
          success: false,
          error: 'Skill already added to your profile'
        });
      }

      // Add skill to user profile
      const result = await pool.query(
        `INSERT INTO user_skills (user_id, skill_id, proficiency_level)
         VALUES ($1, $2, $3)
         RETURNING id`, // Only need ID here
        [userId, parsedSkillId, proficiencyLevel ?? null] // Allow null proficiency
      );

      // Return the complete skill info
      const addedSkill = await pool.query(
        `SELECT us.id, s.id as skill_id, s.name, s.category, us.proficiency_level
         FROM user_skills us
         JOIN skills s ON us.skill_id = s.id
         WHERE us.id = $1`,
        [result.rows[0].id]
      );

      // Update profile completion
      await updateProfileCompletion(userId);

      res.status(201).json({
        success: true,
        data: addedSkill.rows[0]
      });
    } catch (error) {
      logger.error('Add skill error:', error);
      next(error);
    }
  };

// Remove a skill from user profile
export const removeSkill = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      const skillId = parseInt(req.params.skillId, 10); // skillId from URL parameter
       if (!userId) {
        return res.status(401).json({ success: false, error: 'User not authenticated' });
    }
       if (isNaN(skillId)) {
        return res.status(400).json({ success: false, error: 'Invalid Skill ID format in URL parameter' });
    }

      // Check if user has this skill using skillId from params
      const result = await pool.query(
        'SELECT id FROM user_skills WHERE user_id = $1 AND skill_id = $2',
        [userId, skillId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Skill not found in your profile'
        });
      }

      // Remove the skill
      const deleteResult = await pool.query(
        'DELETE FROM user_skills WHERE user_id = $1 AND skill_id = $2',
        [userId, skillId]
      );

      if (deleteResult.rowCount === 0) {
          logger.warn(`Attempted to delete skill ${skillId} for user ${userId}, but no rows affected.`);
          return res.status(404).json({ success: false, error: 'Skill not found during deletion attempt.' });
      }
      logger.info(`Deleted skill ${skillId} for user ${userId}.`);

      // Update profile completion
      await updateProfileCompletion(userId);

      res.status(200).json({
        success: true,
        data: {} // Indicate successful deletion
      });
    } catch (error) {
      logger.error('Remove skill error:', error);
      next(error);
    }
  };

// Get user experience entries
export const getExperiences = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
       if (!userId) {
        return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

      const result = await pool.query(
        `SELECT * FROM user_experiences
         WHERE user_id = $1
         ORDER BY start_date DESC, created_at DESC`, // Added created_at for tie-breaking
        [userId]
      );

      res.status(200).json({
        success: true,
        count: result.rows.length,
        data: result.rows
      });
    } catch (error) {
      logger.error('Get experiences error:', error);
      next(error);
    }
  };

// Add a new experience entry
export const addExperience = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
       if (!userId) {
        return res.status(401).json({ success: false, error: 'User not authenticated' });
    }
      const {
        company_name,
        job_title,
        location,
        start_date,
        end_date,
        is_current,
        description,
        responsibilities,
        achievements
      } = req.body;

      // Basic validation
      if (!company_name || !job_title || !start_date) {
          return res.status(400).json({ success: false, error: 'Company name, job title, and start date are required.' });
      }
      // Ensure end_date is provided if is_current is explicitly false
      if (is_current === false && !end_date) {
          return res.status(400).json({ success: false, error: 'End date is required if not currently working here.' });
      }
      // Ensure start_date is valid
      if (isNaN(Date.parse(start_date))) {
          return res.status(400).json({ success: false, error: 'Invalid start date format.' });
      }
      // Ensure end_date is valid if provided
      if (end_date && isNaN(Date.parse(end_date))) {
          return res.status(400).json({ success: false, error: 'Invalid end date format.' });
      }

      const finalIsCurrent = is_current ?? false; // Default to false if not provided
      const finalEndDate = finalIsCurrent ? null : end_date; // Set end_date to null if current

      const result = await pool.query(
        `INSERT INTO user_experiences
         (user_id, company_name, job_title, location, start_date, end_date, is_current, description, responsibilities, achievements)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          userId,
          company_name,
          job_title,
          location ?? null,
          start_date,
          finalEndDate,
          finalIsCurrent,
          description ?? null,
          responsibilities ?? null,
          achievements ?? null
        ]
      );

      // Update profile completion
      await updateProfileCompletion(userId);

      res.status(201).json({
        success: true,
        data: result.rows[0]
      });
    } catch (error) {
      logger.error('Add experience error:', error);
      next(error);
    }
  };

// Update an experience entry
export const updateExperience = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      const experienceId = parseInt(req.params.id, 10);
       if (!userId) {
        return res.status(401).json({ success: false, error: 'User not authenticated' });
    }
       if (isNaN(experienceId)) {
        return res.status(400).json({ success: false, error: 'Invalid Experience ID format' });
    }
      const {
        company_name,
        job_title,
        location,
        start_date,
        end_date,
        is_current,
        description,
        responsibilities,
        achievements
      } = req.body;

      // Check if experience exists and belongs to user
      const checkResult = await pool.query(
        'SELECT id, end_date, is_current FROM user_experiences WHERE id = $1 AND user_id = $2',
        [experienceId, userId]
      );

      if (checkResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Experience not found or not authorized'
        });
      }
      const currentExperience = checkResult.rows[0];

      // Determine final is_current and end_date based on input or existing values
      const finalIsCurrent = is_current !== undefined ? is_current : currentExperience.is_current;
      let finalEndDate = currentExperience.end_date; // Keep existing by default

      if (finalIsCurrent === true) {
          finalEndDate = null; // Set end_date to null if current
      } else if (end_date !== undefined) {
          // If not current, use provided end_date or keep existing if end_date is not provided in request
          if (isNaN(Date.parse(end_date))) {
              return res.status(400).json({ success: false, error: 'Invalid end date format.' });
          }
          finalEndDate = end_date;
      } else if (finalIsCurrent === false && finalEndDate === null) {
          // If changing from current=true to current=false and no end_date provided, require end_date
          return res.status(400).json({ success: false, error: 'End date is required when setting is_current to false.' });
      }

      // Validate start_date if provided
      if (start_date && isNaN(Date.parse(start_date))) {
          return res.status(400).json({ success: false, error: 'Invalid start date format.' });
      }


      const result = await pool.query(
        `UPDATE user_experiences
         SET company_name = COALESCE($1, company_name),
             job_title = COALESCE($2, job_title),
             location = COALESCE($3, location),
             start_date = COALESCE($4, start_date),
             end_date = $5, -- Use calculated finalEndDate
             is_current = $6, -- Use calculated finalIsCurrent
             description = COALESCE($7, description),
             responsibilities = COALESCE($8, responsibilities),
             achievements = COALESCE($9, achievements),
             updated_at = NOW()
         WHERE id = $10 AND user_id = $11
         RETURNING *`,
        [
          company_name,
          job_title,
          location,
          start_date,
          finalEndDate,
          finalIsCurrent,
          description,
          responsibilities,
          achievements,
          experienceId,
          userId
        ]
      );

      // Update profile completion (might not change if just editing details)
      await updateProfileCompletion(userId);

      res.status(200).json({
        success: true,
        data: result.rows[0]
      });
    } catch (error) {
      logger.error('Update experience error:', error);
      next(error);
    }
  };

// Delete an experience entry
export const deleteExperience = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      const experienceId = parseInt(req.params.id, 10);
       if (!userId) {
        return res.status(401).json({ success: false, error: 'User not authenticated' });
    }
       if (isNaN(experienceId)) {
        return res.status(400).json({ success: false, error: 'Invalid Experience ID format' });
    }

      // Check if experience exists and belongs to user
      const checkResult = await pool.query(
        'SELECT id FROM user_experiences WHERE id = $1 AND user_id = $2',
        [experienceId, userId]
      );

      if (checkResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Experience not found or not authorized'
        });
      }

      const deleteResult = await pool.query(
        'DELETE FROM user_experiences WHERE id = $1 AND user_id = $2',
        [experienceId, userId]
      );

      if (deleteResult.rowCount === 0) {
          logger.warn(`Attempted to delete experience ${experienceId} for user ${userId}, but no rows affected.`);
          return res.status(404).json({ success: false, error: 'Experience not found during deletion attempt.' });
      }
      logger.info(`Deleted experience ${experienceId} for user ${userId}.`);

      // Update profile completion
      await updateProfileCompletion(userId);

      res.status(200).json({
        success: true,
        data: {} // Indicate successful deletion
      });
    } catch (error) {
      logger.error('Delete experience error:', error);
      next(error);
    }
  };

// Get user education entries
export const getEducations = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
       if (!userId) {
        return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

      const result = await pool.query(
        `SELECT * FROM user_educations
         WHERE user_id = $1
         ORDER BY start_date DESC, created_at DESC`, // Added created_at for tie-breaking
        [userId]
      );

      res.status(200).json({
        success: true,
        count: result.rows.length,
        data: result.rows
      });
    } catch (error) {
      logger.error('Get educations error:', error);
      next(error);
    }
  };

// Add a new education entry
export const addEducation = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
       if (!userId) {
        return res.status(401).json({ success: false, error: 'User not authenticated' });
    }
      const {
        institution_name,
        degree,
        field_of_study,
        location,
        start_date,
        end_date,
        is_current,
        description,
        achievements
      } = req.body;

      // Basic validation
      if (!institution_name || !degree || !start_date) {
          return res.status(400).json({ success: false, error: 'Institution name, degree, and start date are required.' });
      }
       if (is_current === false && !end_date) {
          return res.status(400).json({ success: false, error: 'End date is required if not currently studying here.' });
      }
      if (isNaN(Date.parse(start_date))) {
          return res.status(400).json({ success: false, error: 'Invalid start date format.' });
      }
      if (end_date && isNaN(Date.parse(end_date))) {
          return res.status(400).json({ success: false, error: 'Invalid end date format.' });
      }

      const finalIsCurrent = is_current ?? false;
      const finalEndDate = finalIsCurrent ? null : end_date;

      const result = await pool.query(
        `INSERT INTO user_educations
         (user_id, institution_name, degree, field_of_study, location, start_date, end_date, is_current, description, achievements)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          userId,
          institution_name,
          degree,
          field_of_study ?? null,
          location ?? null,
          start_date,
          finalEndDate,
          finalIsCurrent,
          description ?? null,
          achievements ?? null
        ]
      );

      // Update profile completion
      await updateProfileCompletion(userId);

      res.status(201).json({
        success: true,
        data: result.rows[0]
      });
    } catch (error) {
      logger.error('Add education error:', error);
      next(error);
    }
  };

// Update an education entry
export const updateEducation = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      const educationId = parseInt(req.params.id, 10);
       if (!userId) {
        return res.status(401).json({ success: false, error: 'User not authenticated' });
    }
       if (isNaN(educationId)) {
        return res.status(400).json({ success: false, error: 'Invalid Education ID format' });
    }
      const {
        institution_name,
        degree,
        field_of_study,
        location,
        start_date,
        end_date,
        is_current,
        description,
        achievements
      } = req.body;

      // Check if education exists and belongs to user
      const checkResult = await pool.query(
        'SELECT id, end_date, is_current FROM user_educations WHERE id = $1 AND user_id = $2',
        [educationId, userId]
      );

      if (checkResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Education not found or not authorized'
        });
      }
      const currentEducation = checkResult.rows[0];

      // Determine final is_current and end_date
      const finalIsCurrent = is_current !== undefined ? is_current : currentEducation.is_current;
      let finalEndDate = currentEducation.end_date;

      if (finalIsCurrent === true) {
          finalEndDate = null;
      } else if (end_date !== undefined) {
          if (isNaN(Date.parse(end_date))) {
              return res.status(400).json({ success: false, error: 'Invalid end date format.' });
          }
          finalEndDate = end_date;
      } else if (finalIsCurrent === false && finalEndDate === null) {
          return res.status(400).json({ success: false, error: 'End date is required when setting is_current to false.' });
      }

      // Validate start_date if provided
      if (start_date && isNaN(Date.parse(start_date))) {
          return res.status(400).json({ success: false, error: 'Invalid start date format.' });
      }

      const result = await pool.query(
        `UPDATE user_educations
         SET institution_name = COALESCE($1, institution_name),
             degree = COALESCE($2, degree),
             field_of_study = COALESCE($3, field_of_study),
             location = COALESCE($4, location),
             start_date = COALESCE($5, start_date),
             end_date = $6, -- Use calculated finalEndDate
             is_current = $7, -- Use calculated finalIsCurrent
             description = COALESCE($8, description),
             achievements = COALESCE($9, achievements),
             updated_at = NOW()
         WHERE id = $10 AND user_id = $11
         RETURNING *`,
        [
          institution_name,
          degree,
          field_of_study,
          location,
          start_date,
          finalEndDate,
          finalIsCurrent,
          description,
          achievements,
          educationId,
          userId
        ]
      );

      // Update profile completion (might not change if just editing details)
      await updateProfileCompletion(userId);

      res.status(200).json({
        success: true,
        data: result.rows[0]
      });
    } catch (error) {
      logger.error('Update education error:', error);
      next(error);
    }
  };

// Delete an education entry
export const deleteEducation = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      const educationId = parseInt(req.params.id, 10);
       if (!userId) {
        return res.status(401).json({ success: false, error: 'User not authenticated' });
    }
       if (isNaN(educationId)) {
        return res.status(400).json({ success: false, error: 'Invalid Education ID format' });
    }

      // Check if education exists and belongs to user
      const checkResult = await pool.query(
        'SELECT id FROM user_educations WHERE id = $1 AND user_id = $2',
        [educationId, userId]
      );

      if (checkResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Education not found or not authorized'
        });
      }

      const deleteResult = await pool.query(
        'DELETE FROM user_educations WHERE id = $1 AND user_id = $2',
        [educationId, userId]
      );

      if (deleteResult.rowCount === 0) {
          logger.warn(`Attempted to delete education ${educationId} for user ${userId}, but no rows affected.`);
          return res.status(404).json({ success: false, error: 'Education not found during deletion attempt.' });
      }
      logger.info(`Deleted education ${educationId} for user ${userId}.`);

      // Update profile completion
      await updateProfileCompletion(userId);

      res.status(200).json({
        success: true,
        data: {} // Indicate successful deletion
      });
    } catch (error) {
      logger.error('Delete education error:', error);
      next(error);
    }
  };

// Helper function to update profile completion percentage
// Accepts an optional DB client for transactions
const updateProfileCompletion = async (userId: number, dbClient?: PoolClient) => {
    const queryRunner = dbClient || pool; // Use transaction client if provided, else pool
    try {
      // Get counts of user's profile data
      const countResult = await queryRunner.query(
        `SELECT
          (SELECT COUNT(*) FROM user_experiences WHERE user_id = $1) AS experience_count,
          (SELECT COUNT(*) FROM user_educations WHERE user_id = $1) AS education_count,
          (SELECT COUNT(*) FROM user_skills WHERE user_id = $1) AS skill_count,
          (SELECT COUNT(*) FROM user_documents WHERE user_id = $1 AND document_type = 'resume') AS resume_count
        `,
        [userId]
      );

      const counts = countResult.rows[0];

      // Get current profile data needed for calculation
      const profileResult = await queryRunner.query(
        `SELECT job_title, location, profile_summary, professional_summary,
                years_of_experience, experience_level, primary_industry,
                website_url, linkedin_url, github_url, profile_image_url
         FROM user_profiles WHERE user_id = $1`,
        [userId]
      );

      // Handle case where profile might not exist yet (shouldn't happen if created on register)
      if (profileResult.rows.length === 0) {
          logger.warn(`Profile not found for user ${userId} during completion update.`);
          return; // Exit if no profile row exists
      }
      const profile = profileResult.rows[0];

      // Calculate profile completion (Refined Logic with Weights)
      let completionPercentage = 0;
      const weights = {
          basicInfo: { job_title: 5, location: 5, years_of_experience: 5, experience_level: 5, primary_industry: 5 }, // 25%
          summaries: { profile_summary: 10, professional_summary: 10 }, // 20%
          links: { website_url: 3, linkedin_url: 4, github_url: 3 }, // Max 10%
          profileImage: 5, // 5% for having a profile image
          experience: 15, // Max 15%
          education: 10, // Max 10%
          skills: 15, // Max 15%
          resume: 10 // 10% if exists
          // Total: 25 + 20 + 10 + 5 + 15 + 10 + 15 + 10 = 110 (Will cap at 100)
      };

      // Basic Info
      Object.keys(weights.basicInfo).forEach((key) => {
          if (profile[key]) completionPercentage += weights.basicInfo[key as keyof typeof weights.basicInfo];
      });

      // Summaries
      Object.keys(weights.summaries).forEach((key) => {
          if (profile[key]) completionPercentage += weights.summaries[key as keyof typeof weights.summaries];
      });

      // Links (cap at 10%)
      let linkScore = 0;
       Object.keys(weights.links).forEach((key) => {
          if (profile[key]) linkScore += weights.links[key as keyof typeof weights.links];
      });
      completionPercentage += Math.min(linkScore, 10);

      // Profile Image
      if (profile.profile_image_url) {
          completionPercentage += weights.profileImage;
      }

      // Experience (Scale based on count, max 15)
      if (counts.experience_count > 0) {
        completionPercentage += Math.min(weights.experience, 5 + (counts.experience_count * 2)); // Example scaling: 5 base + 2 per entry
      }

      // Education (Scale based on count, max 10)
      if (counts.education_count > 0) {
        completionPercentage += Math.min(weights.education, 5 + (counts.education_count * 2.5)); // Example scaling
      }

      // Skills (Scale based on count, max 15)
      if (counts.skill_count > 0) {
        completionPercentage += Math.min(weights.skills, 3 + (counts.skill_count * 1)); // Example scaling: 3 base + 1 per skill
      }

      // Resume
      if (counts.resume_count > 0) {
        completionPercentage += weights.resume;
      }

      // Ensure percentage is between 0 and 100
      const finalPercentage = Math.max(0, Math.min(100, Math.round(completionPercentage)));

      // Update profile completion in the database
      await queryRunner.query(
        `UPDATE user_profiles SET profile_completion = $1 WHERE user_id = $2`,
        [finalPercentage, userId]
      );
      logger.info(`Updated profile completion for user ${userId} to ${finalPercentage}%`);

    } catch (error) {
      logger.error(`Update profile completion error for user ${userId}:`, error);
      // Do not re-throw if called from within another try/catch (i.e., if dbClient was provided)
      // Only re-throw if this function was called directly and failed
      if (!dbClient) {
          throw error;
      }
      // If part of a transaction, the calling function's catch block will handle the rollback.
    }
  };
