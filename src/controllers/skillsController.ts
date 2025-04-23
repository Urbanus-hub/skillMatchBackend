import { Request, Response, NextFunction } from 'express';
import pool from '../config/db';
import { logger } from '../utils/logger';

// Get all skills
export const getAllSkills = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { category, search } = req.query;
    
    let query = 'SELECT * FROM skills';
    const queryParams: any[] = [];
    let paramCount = 1;
    
    // Add conditions if filters are provided
    if (category || search) {
      query += ' WHERE';
      
      if (category) {
        query += ` category = $${paramCount}`;
        queryParams.push(category);
        paramCount++;
      }
      
      if (search) {
        if (category) query += ' AND';
        query += ` name ILIKE $${paramCount}`;
        queryParams.push(`%${search}%`);
      }
    }
    
    query += ' ORDER BY category, name';
    
    const result = await pool.query(query, queryParams);
    
    res.status(200).json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    logger.error('Get all skills error:', error);
    next(error);
  }
};

// Get skill categories
export const getSkillCategories = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query(
      'SELECT DISTINCT category FROM skills ORDER BY category'
    );
    
    res.status(200).json({
      success: true,
      count: result.rows.length,
      data: result.rows.map(row => row.category)
    });
  } catch (error) {
    logger.error('Get skill categories error:', error);
    next(error);
  }
};

// Add new skill (admin only)
export const addSkill = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, category } = req.body;
    
    // Check if skill already exists
    const existingSkill = await pool.query(
      'SELECT * FROM skills WHERE name ILIKE $1',
      [name]
    );
    
    if (existingSkill.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Skill already exists'
      });
    }
    
    // Add new skill
    const result = await pool.query(
      'INSERT INTO skills (name, category) VALUES ($1, $2) RETURNING *',
      [name, category]
    );
    
    res.status(201).json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Add skill error:', error);
    next(error);
  }
};

// Export functions
