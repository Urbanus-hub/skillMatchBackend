import { protect, authorize } from '../middlewares/auth';
import express from 'express';
import {
  getAllSkills,
  getSkillCategories,
  addSkill
} from '../controllers/skillsController';

const router = express.Router();

// Public routes
router.get('/', getAllSkills);
router.get('/categories', getSkillCategories);

// Admin routes
router.post('/', protect, authorize('admin','employer','job_seeker'), addSkill);

export default router;