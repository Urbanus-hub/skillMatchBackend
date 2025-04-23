// c:\Users\urban\Documents\Teach2giveFinal\skillMatchAi-backend\src\routes\user.routes.ts

import express from 'express';
import { protect } from '../middlewares/auth';
import multer from 'multer'; // Import multer
import path from 'path'; // Import path for file handling if needed
import fs from 'fs'; // Import fs for directory creation

// --- Multer Configuration ---
// Ensure the uploads directory exists
const uploadDir = path.join(__dirname, '../../uploads'); // Adjust path as needed
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir); // Save files to the 'uploads' directory
  },
  filename: function (req, file, cb) {
    // Create a unique filename: fieldname-timestamp.extension
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Configure file filter (optional: restrict file types)
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // Accept common document types
  if (file.mimetype === 'application/pdf' || file.mimetype === 'application/msword' || file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF and Word documents are allowed.'));
  }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // Limit file size to 5MB (optional)
});
// --- End Multer Configuration ---


import {
  getProfile,
  updateProfile,
  getSkills,
  addSkill,
  removeSkill,
  getExperiences,
  addExperience,
  updateExperience,
  deleteExperience,
  getEducations,
  addEducation,
  updateEducation,
  deleteEducation,
  // --- Import Resume Controllers ---
  getResumes,
  uploadResume,
  deleteResume
} from '../controllers/user.controller';

const router = express.Router();

// All routes are protected
router.use(protect);

// Profile routes
router.get('/profile', getProfile);
// Add multer middleware for single file upload named 'profileImage' (adjust field name if different)
router.put('/profile', upload.single('profileImage'), updateProfile);

// Skills routes
router.get('/skills', getSkills);
router.post('/skills', addSkill);
router.delete('/skills/:skillId', removeSkill);

// Experience routes
router.get('/experiences', getExperiences);
router.post('/experiences', addExperience);
router.put('/experiences/:id', updateExperience);
router.delete('/experiences/:id', deleteExperience);

// Education routes
router.get('/educations', getEducations);
router.post('/educations', addEducation);
router.put('/educations/:id', updateEducation);
router.delete('/educations/:id', deleteEducation);

// --- Resume Routes ---
router.get('/resumes', getResumes);
// Use multer middleware for single file upload named 'resumeFile' (adjust if needed)
router.post('/resumes', upload.single('resumeFile'), uploadResume);
router.delete('/resumes/:id', deleteResume);
// --- End Resume Routes ---

export default router;

