import express from 'express';
import { protect, authorize } from '../middlewares/auth';
import {
  submitApplication,
  getMyApplications,
  getJobApplications,
  updateApplicationStatus,
  withdrawApplication
} from '../controllers/apllicationController';

const router = express.Router();

// All routes are protected
router.use(protect);

// Job seeker routes
router.post('/jobs/:id/apply', authorize('job_seeker'), submitApplication);
router.get('/user/applications', getMyApplications);
router.put('/user/applications/:id/withdraw', withdrawApplication);

// Employer routes
router.get('/jobs/:id/applications', authorize('employer', 'admin'), getJobApplications);
router.put('/applications/:id/status', authorize('employer', 'admin'), updateApplicationStatus);

export default router;