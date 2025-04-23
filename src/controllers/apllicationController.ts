// src/controllers/applicationController.ts (Assuming renamed file)
import { Request, Response, NextFunction } from 'express';
import pool from '../config/db'; // Corrected path if needed
import { logger } from '../utils/logger';
import { QueryResult } from 'pg'; // Import QueryResult

// Define interfaces for DB rows (adjust based on actual schema)
interface JobApplication {
  id: number;
  user_id: number;
  job_id: number;
  application_date: Date; // Corrected name from applied_at if needed
  status: string; // Consider using the application_status ENUM type
  cover_letter?: string;
  resume_id?: number;
  contact_email?: string;
  contact_phone?: string;
  custom_answers?: any; // Or define a specific type
  feedback?: string;
  updated_at: Date;
  // Fields added via JOINs
  job_title?: string;
  location?: string;
  job_type?: string;
  is_remote?: boolean;
  company_name?: string;
  company_logo?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  applicant_job_title?: string;
  years_of_experience?: number;
  resume_url?: string; // Corresponds to storage_url
  posted_by?: number; // From jobs table JOIN
}

interface Job {
    id: number;
    posted_by?: number; // Ensure this exists in your Job interface/table
    title?: string;
    // other job fields
}

interface Company {
    name?: string;
    // other company fields
}

interface User {
    id: number;
    first_name?: string;
    last_name?: string;
    email?: string;
    // other user fields
}

interface UserProfile {
    job_title?: string;
    years_of_experience?: number;
    // other profile fields
}

interface UserDocument {
    id: number;
    storage_url?: string; // Corrected name
    // other document fields
}

interface Skill {
    id: number;
    name: string;
    category?: string;
    proficiency_level?: number; // From user_skills join
}


// Define AuthRequest locally or import from a shared types file/middleware
interface AuthRequest extends Request {
  user?: {
    id: number; // Ensure this matches the actual property name from your auth middleware ('id' or 'user_id')
    user_type: string;
  };
}

// Submit a job application
export const submitApplication = async (req: AuthRequest, res: Response, next: NextFunction): Promise<Response | void> => {
  try {
    const userId = req.user?.id; // Use 'id' based on middleware example
    const userType = req.user?.user_type;

    if (!userId) {
        return res.status(401).json({ success: false, error: 'User not authenticated' });
    }
    if (userType !== 'job_seeker') {
      return res.status(403).json({ success: false, error: 'Only job seekers can apply for jobs' });
    }

    const jobId = parseInt(req.params.id, 10); // Parse jobId
    if (isNaN(jobId)) {
        return res.status(400).json({ success: false, error: 'Invalid job ID format' });
    }

    const {
      cover_letter,
      resume_id, // Ensure frontend sends this ID (from user_documents)
      contact_email,
      contact_phone,
      custom_answers
    }: { // Type the body
        cover_letter?: string;
        resume_id?: number;
        contact_email?: string;
        contact_phone?: string;
        custom_answers?: any;
    } = req.body;

    // Check if job exists
    const jobResult: QueryResult<Job> = await pool.query('SELECT id FROM jobs WHERE id = $1', [jobId]);
    if (jobResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    // Check if already applied
    const checkResult: QueryResult<{ id: number }> = await pool.query(
      'SELECT id FROM job_applications WHERE user_id = $1 AND job_id = $2',
      [userId, jobId]
    );
    if (checkResult.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'You have already applied for this job' });
    }

    // Validate resume_id if provided
    if (resume_id) {
        const resumeCheck: QueryResult<{ id: number }> = await pool.query(
            'SELECT id FROM user_documents WHERE id = $1 AND user_id = $2 AND document_type = $3',
            [resume_id, userId, 'resume']
        );
        if (resumeCheck.rows.length === 0) {
            return res.status(400).json({ success: false, error: 'Invalid resume ID provided or does not belong to user.' });
        }
    }

    // Submit application
    const applicationResult: QueryResult<JobApplication> = await pool.query(
      `INSERT INTO job_applications
       (user_id, job_id, cover_letter, resume_id, contact_email, contact_phone, custom_answers, application_date, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       RETURNING *`,
      [userId, jobId, cover_letter ?? null, resume_id ?? null, contact_email ?? null, contact_phone ?? null, custom_answers ?? null]
    );

    // Get job details for response
    const jobDetails: QueryResult<{ title: string; company_name: string }> = await pool.query(
      `SELECT j.title, c.name as company_name
       FROM jobs j
       JOIN companies c ON j.company_id = c.id
       WHERE j.id = $1`,
      [jobId]
    );

    return res.status(201).json({
      success: true,
      data: {
        ...applicationResult.rows[0],
        job_title: jobDetails.rows[0]?.title, // Use optional chaining
        company_name: jobDetails.rows[0]?.company_name // Use optional chaining
      }
    });
  } catch (error) {
    logger.error('Submit application error:', error);
    next(error);
  }
};

// Get my job applications
export const getMyApplications = async (req: AuthRequest, res: Response, next: NextFunction): Promise<Response | void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
        return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

    const { status, page = 1, limit = 10 } = req.query;

    const queryParams: any[] = [userId];
    let queryConditions = ['ja.user_id = $1'];
    let paramCount = 2;

    if (status && typeof status === 'string') { // Validate status type
      queryConditions.push(`ja.status = $${paramCount}`);
      queryParams.push(status);
      paramCount++;
    }

    // Validate and parse pagination params
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1) {
        return res.status(400).json({ success: false, error: 'Invalid pagination parameters' });
    }

    const offset = (pageNum - 1) * limitNum;
    queryParams.push(limitNum);
    queryParams.push(offset);

    const whereClause = `WHERE ${queryConditions.join(' AND ')}`;

    // Get applications
    const applicationsQuery = `
      SELECT ja.id, ja.job_id, ja.application_date, ja.status, ja.updated_at,
             j.title as job_title, j.location, j.job_type, j.is_remote,
             c.name as company_name, c.logo_url as company_logo
      FROM job_applications ja
      JOIN jobs j ON ja.job_id = j.id
      JOIN companies c ON j.company_id = c.id
      ${whereClause}
      ORDER BY ja.application_date DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    const applicationResult: QueryResult<JobApplication> = await pool.query(applicationsQuery, queryParams);

    // Get total count for pagination
    const countParams = queryParams.slice(0, -2); // Remove limit and offset
    const countQuery = `
      SELECT COUNT(*)
      FROM job_applications ja
      JOIN jobs j ON ja.job_id = j.id
      JOIN companies c ON j.company_id = c.id
      ${whereClause}
    `;

    const countResult: QueryResult<{ count: string }> = await pool.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0]?.count || '0', 10);

    return res.status(200).json({
      success: true,
      count: applicationResult.rows.length,
      pagination: {
        total: totalCount,
        page: pageNum,
        pages: Math.ceil(totalCount / limitNum)
      },
      data: applicationResult.rows
    });
  } catch (error) {
    logger.error('Get my applications error:', error);
    next(error);
  }
};

// Get applications for a job (for employers)
export const getJobApplications = async (req: AuthRequest, res: Response, next: NextFunction): Promise<Response | void> => {
  try {
    const requestingUserId = req.user?.id;
    const userType = req.user?.user_type;
    if (!requestingUserId) {
        return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

    const jobId = parseInt(req.params.id, 10); // Use req.params.id based on typical REST patterns
    if (isNaN(jobId)) {
        return res.status(400).json({ success: false, error: 'Invalid job ID format' });
    }

    const { status, page = 1, limit = 10 } = req.query;

    // Check if job exists and user is authorized
    const jobCheck: QueryResult<Job> = await pool.query(
      'SELECT id, posted_by FROM jobs WHERE id = $1', // Select posted_by
      [jobId]
    );
    if (jobCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }
    const job = jobCheck.rows[0];

    // Authorization check (Job poster or Admin)
    if (job.posted_by !== requestingUserId && userType !== 'admin') {
      return res.status(403).json({ success: false, error: 'Not authorized to view these applications' });
    }

    const queryParams: any[] = [jobId];
    let queryConditions = ['ja.job_id = $1'];
    let paramCount = 2;

    if (status && typeof status === 'string') {
      queryConditions.push(`ja.status = $${paramCount}`);
      queryParams.push(status);
      paramCount++;
    }

    // Validate and parse pagination params
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
     if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1) {
        return res.status(400).json({ success: false, error: 'Invalid pagination parameters' });
    }

    const offset = (pageNum - 1) * limitNum;
    queryParams.push(limitNum);
    queryParams.push(offset);

    const whereClause = `WHERE ${queryConditions.join(' AND ')}`;

    // Get applications with applicant details
    const applicationsQuery = `
      SELECT ja.id, ja.user_id, ja.application_date, ja.status, ja.updated_at, ja.cover_letter, ja.contact_email, ja.contact_phone,
             u.first_name, u.last_name, u.email,
             p.job_title as applicant_job_title, p.years_of_experience,
             d.storage_url as resume_url -- Corrected column name
      FROM job_applications ja
      JOIN users u ON ja.user_id = u.id
      LEFT JOIN user_profiles p ON u.id = p.user_id
      LEFT JOIN user_documents d ON ja.resume_id = d.id -- Join based on resume_id
      ${whereClause}
      ORDER BY ja.application_date DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    const applicationResult: QueryResult<JobApplication> = await pool.query(applicationsQuery, queryParams);

    // Get total count for pagination
    const countParams = queryParams.slice(0, -2); // Remove limit and offset
    const countQuery = `
      SELECT COUNT(*)
      FROM job_applications ja
      JOIN users u ON ja.user_id = u.id
      LEFT JOIN user_profiles p ON u.id = p.user_id
      LEFT JOIN user_documents d ON ja.resume_id = d.id
      ${whereClause}
    `;

    const countResult: QueryResult<{ count: string }> = await pool.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0]?.count || '0', 10);

    // --- Optimization Note: Fetching skills here is N+1 ---
    // Consider fetching skills for all user IDs in applicationResult.rows in one go
    const applicationsWithSkills = await Promise.all(
      applicationResult.rows.map(async (application) => {
        const skillsResult: QueryResult<Skill> = await pool.query(
          `SELECT s.id, s.name, s.category, us.proficiency_level
           FROM user_skills us
           JOIN skills s ON us.skill_id = s.id
           WHERE us.user_id = $1`,
          [application.user_id]
        );
        return {
          ...application,
          skills: skillsResult.rows
        };
      })
    );
    // --- End N+1 section ---

    return res.status(200).json({
      success: true,
      count: applicationsWithSkills.length,
      pagination: {
        total: totalCount,
        page: pageNum,
        pages: Math.ceil(totalCount / limitNum)
      },
      data: applicationsWithSkills
    });
  } catch (error) {
    logger.error('Get job applications error:', error);
    next(error);
  }
};

// Update application status (for employers)
export const updateApplicationStatus = async (req: AuthRequest, res: Response, next: NextFunction): Promise<Response | void> => {
  try {
    const requestingUserId = req.user?.id;
    const userType = req.user?.user_type;
     if (!requestingUserId) {
        return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

    const applicationId = parseInt(req.params.id, 10); // Use req.params.id
    if (isNaN(applicationId)) {
        return res.status(400).json({ success: false, error: 'Invalid application ID format' });
    }

    const { status, feedback }: { status?: string; feedback?: string } = req.body; // Type the body

    // Validate status if provided
    if (!status) {
        return res.status(400).json({ success: false, error: 'Status is required' });
    }
    // TODO: Validate 'status' against the allowed ENUM values if possible

    // Check if application exists and get job's posted_by ID
    const applicationCheck: QueryResult<JobApplication> = await pool.query(
      `SELECT ja.*, j.posted_by
       FROM job_applications ja
       JOIN jobs j ON ja.job_id = j.id
       WHERE ja.id = $1`,
      [applicationId]
    );
    if (applicationCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Application not found' });
    }
    const application = applicationCheck.rows[0];

    // Authorization check (Job poster or Admin)
    if (application.posted_by !== requestingUserId && userType !== 'admin') {
      return res.status(403).json({ success: false, error: 'Not authorized to update this application' });
    }

    // Update application status
    const result: QueryResult<JobApplication> = await pool.query(
      `UPDATE job_applications
       SET status = $1, feedback = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [status, feedback ?? null, applicationId]
    );

    // TODO: Optionally send a notification to the job seeker about the status update

    return res.status(200).json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Update application status error:', error);
    next(error);
  }
};

// Withdraw an application (for job seekers)
export const withdrawApplication = async (req: AuthRequest, res: Response, next: NextFunction): Promise<Response | void> => {
  try {
    const userId = req.user?.id;
     if (!userId) {
        return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

    const applicationId = parseInt(req.params.id, 10); // Use req.params.id
     if (isNaN(applicationId)) {
        return res.status(400).json({ success: false, error: 'Invalid application ID format' });
    }

    // Check if application exists and belongs to user
    const applicationCheck: QueryResult<{ id: number }> = await pool.query(
      'SELECT id FROM job_applications WHERE id = $1 AND user_id = $2',
      [applicationId, userId]
    );
    if (applicationCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Application not found or not authorized' });
    }

    // Update application status to withdrawn
    const result: QueryResult<JobApplication> = await pool.query(
      `UPDATE job_applications
       SET status = 'withdrawn', updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [applicationId]
    );

    return res.status(200).json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Withdraw application error:', error);
    next(error);
  }
};

// Removed redundant export block
