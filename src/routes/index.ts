import { Router } from 'express';
import authRoutes from './auth.routes';
import userRoutes from './user.routes';
import jobRoutes from './job.routes';
import aiRoutes from './ai.routes';
// import companyRoutes from './company.routes';
// import applicationRoutes from './application.routes';
// import interviewRoutes from './interview.routes';
// import messageRoutes from './message.routes';
// import learningRoutes from './learning.routes';
// import portfolioRoutes from './portfolio.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/jobs', jobRoutes);
router.use('/ai', aiRoutes);
// router.use('/companies', companyRoutes);
// router.use('/applications', applicationRoutes);
// router.use('/interviews', interviewRoutes);
// router.use('/messages', messageRoutes);
// router.use('/learning', learningRoutes);
// router.use('/portfolio', portfolioRoutes);

export default router;
