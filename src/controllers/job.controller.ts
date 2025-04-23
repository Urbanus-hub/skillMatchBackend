import { Request, Response, NextFunction } from 'express';
import pool from '../config/db';
import { logger } from '../utils/logger';

interface AuthRequest extends Request {
  user?: {
    id: number;
    user_type: string;
  };
}

// Get all jobs with filtering
export const getJobs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      title,
      company,
      location,
      experience_level,
      job_type,
      salary_min,
      salary_max,
      remote,
      industry,
      skills,
      page = 1,
      limit = 10
    } = req.query;

    const queryParams: any[] = [];
    let queryConditions = [];
    let paramCount = 1;

    // Build query conditions based on filters
    if (title) {
      queryConditions.push(`j.title ILIKE $${paramCount}`);
      queryParams.push(`%${title}%`);
      paramCount++;
    }
    
    if (company) {
      queryConditions.push(`c.name ILIKE $${paramCount}`);
      queryParams.push(`%${company}%`);
      paramCount++;
    }
    
    if (location) {
      queryConditions.push(`j.location ILIKE $${paramCount}`);
      queryParams.push(`%${location}%`);
      paramCount++;
    }
    
    if (experience_level) {
      queryConditions.push(`j.experience_level = $${paramCount}`);
      queryParams.push(experience_level);
      paramCount++;
    }
    
    if (job_type) {
      queryConditions.push(`j.job_type = $${paramCount}`);
      queryParams.push(job_type);
      paramCount++;
    }
    
    if (salary_min) {
      queryConditions.push(`j.salary_min >= $${paramCount}`);
      queryParams.push(Number(salary_min));
      paramCount++;
    }
    
    if (salary_max) {
      queryConditions.push(`j.salary_max <= $${paramCount}`);
      queryParams.push(Number(salary_max));
      paramCount++;
    }
    
    if (remote) {
      queryConditions.push(`j.is_remote = $${paramCount}`);
      queryParams.push(remote === 'true');
      paramCount++;
    }
    
    if (industry) {
      queryConditions.push(`j.industry = $${paramCount}`);
      queryParams.push(industry);
      paramCount++;
    }

    // Add skills filter if provided
    if (skills) {
      const skillsArray = (skills as string).split(',');
      
      if (skillsArray.length > 0) {
        queryConditions.push(`
          (SELECT COUNT(*) FROM job_skills js
           JOIN skills s ON js.skill_id = s.id
           WHERE js.job_id = j.id AND s.name IN (${skillsArray.map((_, i) => `$${paramCount + i}`).join(', ')})) > 0
        `);
        
        skillsArray.forEach(skill => {
          queryParams.push(skill.trim());
        });
        
        paramCount += skillsArray.length;
      }
    }

    // Calculate offset for pagination
    const offset = (Number(page) - 1) * Number(limit);
    queryParams.push(Number(limit));
    queryParams.push(offset);

    // Construct WHERE clause
    const whereClause = queryConditions.length > 0 
      ? `WHERE ${queryConditions.join(' AND ')}`
      : '';

    // Get jobs with pagination
    const jobsQuery = `
      SELECT j.*, c.name as company_name, c.logo_url as company_logo
      FROM jobs j
      JOIN companies c ON j.company_id = c.id
      ${whereClause}
      ORDER BY j.posted_date DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    const jobsResult = await pool.query(jobsQuery, queryParams);

    // Get total count for pagination
    const countParams = queryParams.slice(0, -2); // Remove limit and offset
    const countQuery = `
      SELECT COUNT(*) 
      FROM jobs j
      JOIN companies c ON j.company_id = c.id
      ${whereClause}
    `;

    const countResult = await pool.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].count);
    
    // For each job, get its skills
    const jobsWithSkills = await Promise.all(
      jobsResult.rows.map(async (job) => {
        const skillsResult = await pool.query(
          `SELECT s.id, s.name, s.category
           FROM job_skills js
           JOIN skills s ON js.skill_id = s.id
           WHERE js.job_id = $1`,
          [job.id]
        );
        
        return {
          ...job,
          skills: skillsResult.rows
        };
      })
    );

    res.status(200).json({
      success: true,
      count: jobsWithSkills.length,
      pagination: {
        total: totalCount,
        page: Number(page),
        pages: Math.ceil(totalCount / Number(limit))
      },
      data: jobsWithSkills
    });
  } catch (error) {
    logger.error('Get jobs error:', error);
    next(error);
  }
};

// Get job by ID
export const getJobById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jobId = req.params.id;

    // Get job details
    const jobResult = await pool.query(
      `SELECT j.*, c.name as company_name, c.logo_url as company_logo,
              c.description as company_description, c.website_url as company_website
       FROM jobs j
       JOIN companies c ON j.company_id = c.id
       WHERE j.id = $1`,
      [jobId]
    );

    if (jobResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    const job = jobResult.rows[0];

    // Get job skills
    const skillsResult = await pool.query(
      `SELECT s.id, s.name, s.category
       FROM job_skills js
       JOIN skills s ON js.skill_id = s.id
       WHERE js.job_id = $1`,
      [jobId]
    );

    // Get similar jobs
    const similarJobsResult = await pool.query(
      `SELECT j.id, j.title, j.location, j.salary_min, j.salary_max, j.job_type,
              j.is_remote, c.name as company_name
       FROM jobs j
       JOIN companies c ON j.company_id = c.id
       WHERE (j.title ILIKE $1 OR j.industry = $2) AND j.id != $3
       LIMIT 5`,
      [`%${job.title.split(' ')[0]}%`, job.industry, jobId]
    );

    // Combine job with skills and similar jobs
    const jobWithDetails = {
      ...job,
      skills: skillsResult.rows,
      similar_jobs: similarJobsResult.rows
    };

    res.status(200).json({
      success: true,
      data: jobWithDetails
    });
  } catch (error) {
    logger.error('Get job by ID error:', error);
    next(error);
  }
};

// Save a job for later
export const saveJob = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const jobId = req.params.id;
    const userId = req.user?.id;

    // Check if job exists
    const jobResult = await pool.query('SELECT * FROM jobs WHERE id = $1', [jobId]);

    if (jobResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    // Check if already saved
    const existingResult = await pool.query(
      'SELECT * FROM saved_jobs WHERE user_id = $1 AND job_id = $2',
      [userId, jobId]
    );

    if (existingResult.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Job already saved'
      });
    }

    // Save job
    await pool.query(
      'INSERT INTO saved_jobs (user_id, job_id) VALUES ($1, $2)',
      [userId, jobId]
    );

    res.status(201).json({
      success: true,
      data: {
        message: 'Job saved successfully'
      }
    });
  } catch (error) {
    logger.error('Save job error:', error);
    next(error);
  }
};

// Unsave a job
export const unsaveJob = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const jobId = req.params.id;
    const userId = req.user?.id;

    // Check if job is saved
    const result = await pool.query(
      'SELECT * FROM saved_jobs WHERE user_id = $1 AND job_id = $2',
      [userId, jobId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Saved job not found'
      });
    }

    // Remove saved job
    await pool.query(
      'DELETE FROM saved_jobs WHERE user_id = $1 AND job_id = $2',
      [userId, jobId]
    );

    res.status(200).json({
      success: true,
      data: {
        message: 'Job removed from saved jobs'
      }
    });
  } catch (error) {
    logger.error('Unsave job error:', error);
    next(error);
  }
};

// Get user's saved jobs
export const getSavedJobs = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;

    const result = await pool.query(
      `SELECT j.id, j.title, j.location, j.salary_min, j.salary_max, j.job_type,
              j.is_remote, j.posted_date, j.application_deadline, j.industry,
              c.name as company_name, c.logo_url as company_logo,
              sj.saved_at
       FROM saved_jobs sj
       JOIN jobs j ON sj.job_id = j.id
       JOIN companies c ON j.company_id = c.id
       WHERE sj.user_id = $1
       ORDER BY sj.saved_at DESC`,
      [userId]
    );

    res.status(200).json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    logger.error('Get saved jobs error:', error);
    next(error);
  }
};

// Create a new job (for employers)
export const createJob = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    const userType = req.user?.user_type;

    // Check if user is an employer
    if (userType !== 'employer' && userType !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Only employers can create job listings'
      });
    }

    const {
      title,
      description,
      responsibilities,
      requirements,
      benefits,
      company_id,
      location,
      job_type,
      is_remote,
      salary_min,
      salary_max,
      industry,
      experience_level,
      education_level,
      application_deadline,
      skills
    } = req.body;

    // Start transaction
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      // Create job
      const jobResult = await client.query(
        `INSERT INTO jobs
         (title, description, responsibilities, requirements, benefits, company_id,
          location, job_type, is_remote, salary_min, salary_max, industry,
          experience_level, education_level, posted_by, application_deadline)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING *`,
        [
          title,
          description,
          responsibilities,
          requirements,
          benefits,
          company_id,
          location,
          job_type,
          is_remote,
          salary_min,
          salary_max,
          industry,
          experience_level,
          education_level,
          userId,
          application_deadline
        ]
      );

      const job = jobResult.rows[0];

      // Add skills if provided
      if (skills && Array.isArray(skills) && skills.length > 0) {
        for (const skillId of skills) {
          await client.query(
            'INSERT INTO job_skills (job_id, skill_id) VALUES ($1, $2)',
            [job.id, skillId]
          );
        }
      }

      await client.query('COMMIT');

      // Get the complete job with company info
      const completeJobResult = await pool.query(
        `SELECT j.*, c.name as company_name
         FROM jobs j
         JOIN companies c ON j.company_id = c.id
         WHERE j.id = $1`,
        [job.id]
      );

      res.status(201).json({
        success: true,
        data: completeJobResult.rows[0]
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Create job error:', error);
    next(error);
  }
};

// Update a job (for employers)
export const updateJob = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const jobId = req.params.id;
    const userId = req.user?.id;
    const userType = req.user?.user_type;

    // Check if job exists and user is authorized
    const jobCheck = await pool.query(
      'SELECT * FROM jobs WHERE id = $1',
      [jobId]
    );

    if (jobCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    const job = jobCheck.rows[0];

    // Check if user is the job poster or an admin
    if (job.posted_by !== userId && userType !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to update this job'
      });
    }

    const {
      title,
      description,
      responsibilities,
      requirements,
      benefits,
      location,
      job_type,
      is_remote,
      salary_min,
      salary_max,
      industry,
      experience_level,
      education_level,
      application_deadline,
      skills
    } = req.body;

    // Start transaction
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      // Update job
      const jobResult = await client.query(
        `UPDATE jobs
         SET title = COALESCE($1, title),
             
    
             description = COALESCE($2, description),
             responsibilities = COALESCE($3, responsibilities),
             requirements = COALESCE($4, requirements),
             benefits = COALESCE($5, benefits),
             location = COALESCE($6, location),
             job_type = COALESCE($7, job_type),
             is_remote = COALESCE($8, is_remote),
             salary_min = COALESCE($9, salary_min),
             salary_max = COALESCE($10, salary_max),
             industry = COALESCE($11, industry),
             experience_level = COALESCE($12, experience_level),
             education_level = COALESCE($13, education_level),
             application_deadline = COALESCE($14, application_deadline),
             updated_at = NOW()
         WHERE id = $15
         RETURNING *`,
        [
          title,
          description,
          responsibilities,
          requirements,
          benefits,
          location,
          job_type,
          is_remote,
          salary_min,
          salary_max,
          industry,
          experience_level,
          education_level,
          application_deadline,
          jobId
        ]
      );

      // Update skills if provided
      if (skills && Array.isArray(skills)) {
        // Remove existing skills
        await client.query('DELETE FROM job_skills WHERE job_id = $1', [jobId]);
        
        // Add new skills
        for (const skillId of skills) {
          await client.query(
            'INSERT INTO job_skills (job_id, skill_id) VALUES ($1, $2)',
            [jobId, skillId]
          );
        }
      }

      await client.query('COMMIT');

      // Get the complete updated job with company info
      const completeJobResult = await pool.query(
        `SELECT j.*, c.name as company_name
         FROM jobs j
         JOIN companies c ON j.company_id = c.id
         WHERE j.id = $1`,
        [jobId]
      );

      res.status(200).json({
        success: true,
        data: completeJobResult.rows[0]
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Update job error:', error);
    next(error);
  }
};

// Delete a job (for employers)
export const deleteJob = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const jobId = req.params.id;
    const userId = req.user?.id;
    const userType = req.user?.user_type;

    // Check if job exists and user is authorized
    const jobCheck = await pool.query(
      'SELECT * FROM jobs WHERE id = $1',
      [jobId]
    );

    if (jobCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    const job = jobCheck.rows[0];

    // Check if user is the job poster or an admin
    if (job.posted_by !== userId && userType !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to delete this job'
      });
    }

    // Start transaction
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      // Delete related records
      await client.query('DELETE FROM job_skills WHERE job_id = $1', [jobId]);
      await client.query('DELETE FROM saved_jobs WHERE job_id = $1', [jobId]);
      await client.query('DELETE FROM job_applications WHERE job_id = $1', [jobId]);
      
      // Delete job
      await client.query('DELETE FROM jobs WHERE id = $1', [jobId]);

      await client.query('COMMIT');

      res.status(200).json({
        success: true,
        data: {
          message: 'Job deleted successfully'
        }
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Delete job error:', error);
    next(error);
  }
};

// Get jobs by employer
export const getEmployerJobs = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    const userType = req.user?.user_type;

    // Check if user is an employer
    if (userType !== 'employer' && userType !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    const {
      status,
      page = 1,
      limit = 10
    } = req.query;

    const queryParams: any[] = [userId];
    let queryConditions = ['j.posted_by = $1'];
    let paramCount = 2;

    if (status) {
      queryConditions.push(`j.status = $${paramCount}`);
      queryParams.push(status);
      paramCount++;
    }

    // Calculate offset for pagination
    const offset = (Number(page) - 1) * Number(limit);
    queryParams.push(Number(limit));
    queryParams.push(offset);

    // Construct WHERE clause
    const whereClause = queryConditions.length > 0 
      ? `WHERE ${queryConditions.join(' AND ')}`
      : '';

    // Get jobs
    const jobsQuery = `
      SELECT j.*, c.name as company_name, c.logo_url as company_logo,
             (SELECT COUNT(*) FROM job_applications ja WHERE ja.job_id = j.id) as application_count
      FROM jobs j
      JOIN companies c ON j.company_id = c.id
      ${whereClause}
      ORDER BY j.posted_date DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    const jobsResult = await pool.query(jobsQuery, queryParams);

    // Get total count for pagination
    const countParams = queryParams.slice(0, -2); // Remove limit and offset
    const countQuery = `
      SELECT COUNT(*) 
      FROM jobs j
      JOIN companies c ON j.company_id = c.id
      ${whereClause}
    `;

    const countResult = await pool.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].count);

    res.status(200).json({
      success: true,
      count: jobsResult.rows.length,
      pagination: {
        total: totalCount,
        page: Number(page),
        pages: Math.ceil(totalCount / Number(limit))
      },
      data: jobsResult.rows
    });
  } catch (error) {
    logger.error('Get employer jobs error:', error);
    next(error);
  }
};

// // Now let's implement the job application controller:
// // Export these functions from this file
// export {
//   getJobById,
//   saveJob,
//   unsaveJob,
//   getSavedJobs,
//   createJob,
//   updateJob,
//   deleteJob,
//   getEmployerJobs
// };