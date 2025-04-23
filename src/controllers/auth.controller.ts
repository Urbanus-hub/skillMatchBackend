import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import pool from '../config/db';
import { logger } from '../utils/logger';

// Register new user
export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { first_name, last_name, email, password, user_type } = req.body;

    // Check if user exists
    const userExists = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (userExists.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'User already exists'
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const result = await pool.query(
      `INSERT INTO users 
       (first_name, last_name, email, password_hash, user_type) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, first_name, last_name, email, user_type, created_at`,
      [first_name, last_name, email, hashedPassword, user_type]
    );

    const user = result.rows[0];

    // Create empty profile
    await pool.query(
      `INSERT INTO user_profiles (user_id) VALUES ($1)`,
      [user.id]
    );

    // Generate token
    const token = generateToken(user.id, user.user_type);

    res.status(201).json({
      success: true,
      data: {
        user: {
          id: user.id,
          first_name: user.first_name,
          last_name: user.last_name,
          email: user.email,
          user_type: user.user_type,
          created_at: user.created_at
        },
        token
      }
    });
  } catch (error) {
    logger.error('Registration error:', error);
    next(error);
  }
};

// Login user
export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;

    // Find user
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    const user = result.rows[0];

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    // Update last login
    await pool.query(
      'UPDATE users SET last_login = NOW() WHERE id = $1',
      [user.id]
    );

    // Generate token
    const token = generateToken(user.id, user.user_type);

    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user.id,
          first_name: user.first_name,
          last_name: user.last_name,
          email: user.email,
          user_type: user.user_type
        },
        token
      }
    });
  } catch (error) {
    logger.error('Login error:', error);
    next(error);
  }
};

// Forgot password
export const forgotPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body;

    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const user = result.rows[0];

    // Generate reset token
    const resetToken = crypto.randomBytes(20).toString('hex');
    const resetPasswordToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');
    
    const resetPasswordExpire = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store token in database
    await pool.query(
      `UPDATE users 
       SET reset_password_token = $1, reset_password_expire = $2 
       WHERE id = $3`,
      [resetPasswordToken, resetPasswordExpire, user.id]
    );

    // In a real app, you would send an email with the reset token
    // For this example, we'll just return it in the response
    res.status(200).json({
      success: true,
      data: {
        message: 'Password reset token generated',
        resetToken // In production, send via email not in the response
      }
    });
  } catch (error) {
    logger.error('Forgot password error:', error);
    next(error);
  }
};

// Reset password
export const resetPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { resetToken } = req.params;
    const { password } = req.body;

    // Hash the token
    const resetPasswordToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');

    // Find user with valid token
    const result = await pool.query(
      `SELECT * FROM users 
       WHERE reset_password_token = $1 
       AND reset_password_expire > NOW()`,
      [resetPasswordToken]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }

    const user = result.rows[0];

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Update password and clear reset token
    await pool.query(
      `UPDATE users 
       SET password_hash = $1, reset_password_token = NULL, reset_password_expire = NULL 
       WHERE id = $2`,
      [hashedPassword, user.id]
    );

    // Generate new token
    const token = generateToken(user.id, user.user_type);

    res.status(200).json({
      success: true,
      data: {
        message: 'Password reset successful',
        token
      }
    });
  } catch (error) {
    logger.error('Reset password error:', error);
    next(error);
  }
};

// Helper function to generate JWT
const generateToken = (id: number, user_type: string): string => {
  return jwt.sign(
    { id, user_type },
    process.env.JWT_SECRET || 'fallback_secret',
    {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    } as jwt.SignOptions
  );
};