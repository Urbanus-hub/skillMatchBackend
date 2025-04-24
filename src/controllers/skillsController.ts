import { Request as ExpressRequest, Response, NextFunction } from 'express';
import pool from '../config/db';
import { logger } from '../utils/logger';

// Extend the Express Request interface to include user property
interface Request extends ExpressRequest {
  user?: {
    id: string | number;
    [key: string]: any;
  };
}

interface UserProfilePayload {
  jobTitle: string | null;
  experience: string | null;
  industry: string | null;
  location: string | null;
  summary: string | null;
}

// User profile update endpoint
export const updateUserProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Get user ID from the authenticated user (from JWT token or session)
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const { jobTitle, experience, industry, location, summary }: UserProfilePayload = req.body;
    
    // Check if user exists
    const userCheck = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );
    
    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    // Update user profile
    const result = await pool.query(
      `UPDATE users SET 
        job_title = $1, 
        experience = $2, 
        industry = $3, 
        location = $4, 
        summary = $5,
        updated_at = NOW()
      WHERE id = $6 
      RETURNING id, name, email, job_title, experience, industry, location, summary, created_at, updated_at`,
      [jobTitle, experience, industry, location, summary, userId]
    );
    
    // Format the response to match expected frontend structure
    const updatedUser = result.rows[0];
    
    // Return success response with updated user data
    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: {
          id: updatedUser.id,
          name: updatedUser.name,
          email: updatedUser.email,
          jobTitle: updatedUser.job_title,
          experience: updatedUser.experience,
          industry: updatedUser.industry,
          location: updatedUser.location,
          summary: updatedUser.summary,
          createdAt: updatedUser.created_at,
          updatedAt: updatedUser.updated_at
        }
      }
    });
  } catch (error) {
    logger.error('Update user profile error:', error);
    next(error);
  }
};

// Get user profile endpoint
export const getUserProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Get user ID from the authenticated user
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }
    
    // Get user profile data
    const result = await pool.query(
      `SELECT 
        id, name, email, job_title, experience, industry, location, summary, 
        created_at, updated_at 
      FROM users WHERE id = $1`,
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    const user = result.rows[0];
    
    // Get user skills (assuming there's a user_skills table)
    const skillsResult = await pool.query(
      `SELECT s.id, s.name, s.category 
      FROM skills s
      JOIN user_skills us ON s.id = us.skill_id
      WHERE us.user_id = $1`,
      [userId]
    );
    
    // Return formatted user profile with skills
    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          jobTitle: user.job_title,
          experience: user.experience,
          industry: user.industry,
          location: user.location,
          summary: user.summary,
          createdAt: user.created_at,
          updatedAt: user.updated_at,
          skills: skillsResult.rows.map(skill => ({
            id: skill.id,
            name: skill.name,
            category: skill.category
          }))
        }
      }
    });
  } catch (error) {
    logger.error('Get user profile error:', error);
    next(error);
  }
};

// Update user skills endpoint
export const updateUserSkills = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Get user ID from the authenticated user
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }
    
    const { skills } = req.body;
    
    if (!Array.isArray(skills)) {
      return res.status(400).json({
        success: false,
        error: 'Skills must be an array'
      });
    }
    
    // Start a transaction
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Delete existing user skills
      await client.query(
        'DELETE FROM user_skills WHERE user_id = $1',
        [userId]
      );
      
      // Add new skills
      if (skills.length > 0) {
        // Prepare values for batch insert
        const values = skills.map((skillId: number, index: number) => 
          `($1, $${index + 2})`
        ).join(', ');
        
        const params = [userId, ...skills];
        
        await client.query(
          `INSERT INTO user_skills (user_id, skill_id) VALUES ${values}`,
          params
        );
      }
      
      await client.query('COMMIT');
      
      // Get updated user skills
      const skillsResult = await client.query(
        `SELECT s.id, s.name, s.category 
        FROM skills s
        JOIN user_skills us ON s.id = us.skill_id
        WHERE us.user_id = $1`,
        [userId]
      );
      
      res.status(200).json({
        success: true,
        message: 'Skills updated successfully',
        data: {
          skills: skillsResult.rows.map(skill => ({
            id: skill.id,
            name: skill.name,
            category: skill.category
          }))
        }
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Update user skills error:', error);
    next(error);
  }
};

// Delete user account
export const deleteAccount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }
    
    // Start a transaction
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Delete user skills
      await client.query('DELETE FROM user_skills WHERE user_id = $1', [userId]);
      
      // Delete user profile
      await client.query('DELETE FROM users WHERE id = $1', [userId]);
      
      await client.query('COMMIT');
      
      res.status(200).json({
        success: true,
        message: 'Account deleted successfully'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Delete account error:', error);
    next(error);
  }
};