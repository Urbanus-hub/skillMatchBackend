import { Request, Response, NextFunction } from 'express';
import { check, validationResult, Result, ValidationError } from 'express-validator';

/**
 * Reusable middleware function to handle validation results.
 * Sends a 400 response with formatted errors if validation fails,
 * otherwise calls next().
 */
const handleValidationErrors = (req: Request, res: Response, next: NextFunction) => {
  const errors: Result<ValidationError> = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      // Map errors to a consistent format { field, message }
      errors: errors.array().map(err => ({
        field: 'param' in err ? err.param : 'unknown', // The field that failed validation
        message: err.msg  // The error message
      }))
    });
  }
  next(); // Proceed to the next middleware/route handler if validation passes
};

// Validate registration input
export const validateRegister = [
  // First name validation
  check('first_name')
    .trim()
    .notEmpty().withMessage('First name is required.')
    .isLength({ min: 2, max: 50 }).withMessage('First name must be between 2 and 50 characters.'),

  // Last name validation
  check('last_name')
    .trim()
    .notEmpty().withMessage('Last name is required.')
    .isLength({ min: 2, max: 50 }).withMessage('Last name must be between 2 and 50 characters.'),

  // Email validation
  check('email')
    .trim()
    .notEmpty().withMessage('Email address is required.')
    .isEmail().withMessage('Please provide a valid email address.')
    .normalizeEmail(), // Normalizes email (e.g., lowercase domain)

  // Password validation
  check('password')
    .trim() // Remove leading/trailing whitespace before validation
    .notEmpty().withMessage('Password is required.')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters long.')
    // Regex requires: 1 lowercase, 1 uppercase, 1 number, 1 special char
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&).'),

  // Password confirmation validation
  check('confirm_password')
    .trim()
    .notEmpty().withMessage('Password confirmation is required.')
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        // Use a specific error message for the custom validation
        throw new Error('Password confirmation does not match password.');
      }
      return true; // Indicates validation passed
    }),

  // User type validation
  check('user_type')
    .trim()
    .notEmpty().withMessage('User type is required.')
    .isIn(['job_seeker', 'employer']).withMessage('User type must be either job_seeker or employer.'),

  // Use the reusable handler
  handleValidationErrors
];

// Validate login input
export const validateLogin = [
  // Email validation
  check('email')
    .trim()
    .notEmpty().withMessage('Email address is required.')
    .isEmail().withMessage('Please provide a valid email address.')
    .normalizeEmail(),

  // Password validation
  check('password')
    .trim() // Important to trim before checking notEmpty
    .notEmpty().withMessage('Password is required.'),

  // Use the reusable handler
  handleValidationErrors
];

// Password Reset validation
export const validatePasswordReset = [
  check('password')
    .trim()
    .notEmpty().withMessage('New password is required.')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters long.')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&).'),

  check('confirm_password')
    .trim()
    .notEmpty().withMessage('Password confirmation is required.')
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('Password confirmation does not match new password.');
      }
      return true;
    }),

  // Use the reusable handler
  handleValidationErrors
];

// Forgot password validation
export const validateForgotPassword = [
  check('email')
    .trim()
    .notEmpty().withMessage('Email address is required.')
    .isEmail().withMessage('Please provide a valid email address.')
    .normalizeEmail(),

  // Use the reusable handler
  handleValidationErrors
];
