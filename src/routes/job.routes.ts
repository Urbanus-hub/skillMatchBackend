import express from 'express';
import { protect, authorize } from '../middlewares/auth'; // Corrected path if needed
import {
  getJobs,
  getJobById,
  saveJob,
  unsaveJob,
  getSavedJobs,
  createJob,
  updateJob,
  deleteJob,
  getEmployerJobs
} from '../controllers/job.controller'; // Corrected path if needed

const router = express.Router();
const employerAdminRoles = ['employer', 'admin']; // Define roles array once

// --- Public Routes ---
router.get('/', getJobs);

// --- Protected Routes ---
router.use(protect);

// --- Specific Protected GET Routes (Define BEFORE /:id) ---
router.get('/user/saved', getSavedJobs);
// Use spread operator (...) to pass array elements as individual arguments
router.get('/employer/listings', authorize(...employerAdminRoles), getEmployerJobs);

// --- Parameterized GET Route (Define AFTER specific GET routes) ---
router.get('/:id', getJobById);

// --- Job Seeker Actions (POST/DELETE on specific job ID) ---
router.post('/:id/save', saveJob);
router.delete('/:id/save', unsaveJob);

// --- Employer/Admin Actions ---
// Use spread operator (...) here as well
router.post('/', authorize(...employerAdminRoles), createJob);
router.put('/:id', authorize(...employerAdminRoles), updateJob);
router.delete('/:id', authorize(...employerAdminRoles), deleteJob);


export default router;
