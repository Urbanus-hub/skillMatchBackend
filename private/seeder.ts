import { Client } from 'pg';
import * as dotenv from 'dotenv';
import { faker } from '@faker-js/faker';
import bcrypt from 'bcryptjs';
import * as ai from '../src/ai'


dotenv.config();

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

// Table names and their dependent tables
const TABLES = [
  'interviews',
  'interviewers',
  'interview_questions',
  'interview_documents',
  'interview_followups',
  'job_applications',
  'saved_jobs',
  'job_skills',
  'portfolio_items',
  'user_skills',
  'user_experience',
  'user_education',
  'user_documents',
  'user_profiles',
  'jobs',
  'messages',
  'message_attachments',
  'message_label_junction',
  'notifications',
  'learning_notes',
  'learning_resources',
  'learning_additional_resources',
  'learning_resource_tags',
  'learning_resource_contents',
  'skills',
  'companies',
  'users',
  'message_labels',
];

async function truncateAllTables() {
  try {
    for (const table of TABLES.reverse()) {
      await client.query(`TRUNCATE TABLE ${table} CASCADE`);
      console.log(`✅ Truncated table: ${table}`);
    }
  } catch (err) {
    console.error('❌ Error truncating tables:', err);
    throw err;
  }
}

const getRandomCount = () => faker.number.int({ min: 20, max: 100 });

// Helper function to generate unique skill names with proper type annotation
function generateUniqueSkills(count: number): { name: string; category: string }[] {
  const skills = new Set<string>();
  const categories = ['Technical', 'Soft', 'Language', 'Design', 'Development', 'Management'];
  
  // Predefined list of skills to ensure uniqueness
  const techSkills = [
    'JavaScript', 'Python', 'React', 'Node.js', 'SQL', 'Java', 'TypeScript',
    'Docker', 'Kubernetes', 'AWS', 'Azure', 'Git', 'GraphQL', 'REST API',
    'MongoDB', 'PostgreSQL', 'Redis', 'C#', 'Go', 'Ruby', 'PHP', 'Swift',
    'Flutter', 'HTML', 'CSS', 'Sass', 'Redux', 'Angular', 'Vue.js', 'TensorFlow',
    'PyTorch', 'Machine Learning', 'Data Science', 'DevOps', 'CI/CD', 'Agile',
    'Scrum', 'Jira', 'Microservices', 'Linux', 'Testing', 'UX/UI Design'
  ];
  
  // Add unique skills to the set
  while (skills.size < count) {
    if (skills.size < techSkills.length) {
      skills.add(techSkills[skills.size]);
    } else {
      // Fallback to ensure we meet the count
      skills.add(`Skill-${faker.string.uuid().substring(0, 8)}`);
    }
  }
  
  return Array.from(skills).map(skill => ({
    name: skill,
    category: faker.helpers.arrayElement(categories)
  }));
}

async function seed() {
  try {
    await client.connect();

    await truncateAllTables();

    // --- BATCH 1: Independent tables ---
    await seedSkills();
    await seedUsers();
    await seedCompanies();
    await seedLearningResources();
    await seedMessageLabels();
    await seedMessages();

    // --- BATCH 2: Depends on BATCH 1 ---
    await seedJobs();                    // ← companies
    await seedUserProfiles();            // ← users
    await seedUserDocuments();           // ← users
    await seedUserEducation();           // ← users
    await seedUserExperience();          // ← users
    await seedUserSkills();              // ← users + skills
    await seedPortfolioItems();          // ← users
    await seedJobSkills();               // ← jobs + skills
    await seedSavedJobs();               // ← users + jobs
    await seedNotifications();           // ← users
    // await seedMessageAttachments();      // ← messages + user_documents
    await seedMessageLabelJunction();    // ← messages + message_labels
    await seedJobApplications();         // ← jobs + users
    await seedInterviews();              // ← jobs + users
    await seedLearningNotes();           // ← learning_resources

    // --- BATCH 3: Depends on Interviews and others ---
    // await seedInterviewDocuments();      // ← interviews + user_documents
    await seedInterviewFollowups();      // ← interviews
    await seedInterviewQuestions();      // ← interviews
    await seedInterviewers();            // ← interviews

    console.log('✅ Seeding complete!');
  } catch (err) {
    console.error('❌ Error seeding DB:', err);
    console.log(await ai.useGemini.devErrorFix(err) )
  } finally {
    await client.end();
  }
}

async function seedSkills() {
  try {
    const skillCount = getRandomCount();
    const uniqueSkills = generateUniqueSkills(skillCount);
    
    for (const skill of uniqueSkills) {
      await client.query(
        `INSERT INTO skills (name, category) VALUES ($1, $2)`,
        [skill.name, skill.category]
      );
    }
    console.log(`✅ Seeded ${skillCount} unique skills`);
  } catch (err) {
    console.error('❌ Error seeding skills:', err);
    throw err;
  }
}

async function seedUsers() {
  try {
    for (let i = 0; i < getRandomCount(); i++) {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('default@123A', salt);
      
      await client.query(
        `INSERT INTO users ( first_name, last_name,  email, password_hash, user_type)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          faker.food.fruit(),
          faker.food.vegetable(),
          `user${i+1}@gmail.com`,
           hashedPassword,
          faker.helpers.arrayElement(['job_seeker', 'employer', 'admin']),
        ]
      );
    }
    console.log(`✅ Seeded users`);
  } catch (err) {
    console.error('❌ Error seeding users:', err);
    throw err;
  }
}

async function seedCompanies() {
  try {
    // Create a set to track unique company names
    const companyNames = new Set<string>();
    
    for (let i = 0; i < getRandomCount(); i++) {
      let companyName = faker.company.name();
      // Ensure uniqueness if there's a unique constraint
      while (companyNames.has(companyName)) {
        companyName = faker.company.name();
      }
      companyNames.add(companyName);
      
      await client.query(
        `INSERT INTO companies (name, description, website_url, logo_url, location, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [
          companyName,
          faker.company.catchPhrase(),
          faker.internet.url(),
          faker.image.avatar(),
          faker.location.city(),
        ]
      );
    }
    console.log(`✅ Seeded companies`);
  } catch (err) {
    console.error('❌ Error seeding companies:', err);
    throw err;
  }
}

async function seedLearningResources() {
  try {
    // Fetch existing user IDs to associate resources
    const { rows: users } = await client.query(`SELECT id FROM users`);
    const userIds = users.map(u => u.id);

    const categories = ['videos', 'books', 'courses', 'articles' ,'other']; // Adjust as per your enum
    const statuses = ['notStarted', 'inProgress', 'completed']; // Adjust as per your enum

    for (let i = 0; i < getRandomCount(); i++) {
      const user_id = faker.helpers.arrayElement(userIds);
      const category = faker.helpers.arrayElement(categories);
      const status = faker.helpers.arrayElement(statuses);
      const progress = status === 'completed' ? 100 : faker.number.int({ min: 0, max: 99 });
      const completed_date = status === 'completed' ? faker.date.recent() : null;

      await client.query(
        `INSERT INTO learning_resources (
          user_id, title, provider, category, url, status, progress, date_added,
          completed_date, description, author, duration_minutes, language,
          level, rating, certificate_url
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, NOW(),
          $8, $9, $10, $11, $12,
          $13, $14, $15
        )`,
        [
          user_id,
          `${faker.lorem.words(2)} Resource`,
          faker.company.name(),
          category,
          faker.internet.url(),
          status,
          progress,
          completed_date,
          faker.lorem.paragraph(),
          faker.person.fullName(),
          faker.number.int({ min: 10, max: 300 }),
          faker.helpers.arrayElement(['English', 'Spanish', 'French', 'German']),
          faker.helpers.arrayElement(['Beginner', 'Intermediate', 'Advanced']),
          faker.number.int({ min: 1, max: 5 }),
          faker.internet.url()
        ]
      );
    }

    console.log(`✅ Seeded learning_resources`);
  } catch (err) {
    console.error('❌ Error seeding learning_resources:', err);
    throw err;
  }
}

async function seedMessageLabels() {
  try {
    const labels = ['Important', 'Work', 'Personal', 'Urgent', 'Follow Up', 'Archive', 'Spam', 'Draft', 'Sent', 'Inbox'];
    const { rows: users } = await client.query(`SELECT id FROM users`);
    const userIds = users.map(u => u.id);

    for (let i = 0; i < labels.length; i++) {
      const user_id = faker.helpers.arrayElement(userIds);

      await client.query(
        `INSERT INTO message_labels (user_id, name, color) VALUES ($1, $2, $3)`,
        [ user_id,labels[i], faker.color.rgb()]
      );
    }
    console.log(`✅ Seeded message labels`);
  } catch (err) {
    console.error('❌ Error seeding message labels:', err);
    throw err;
  }
}

async function seedMessages() {
  try {
    const { rows: users } = await client.query(`SELECT id, first_name FROM users`);
    const { rows: companies } = await client.query(`SELECT id, name FROM companies`);

    const userIds = users.map(u => u.id);
    const companyNames = companies.map(c => c.name);

    for (let i = 0; i < getRandomCount(); i++) {
      await client.query(
        `INSERT INTO messages (
          sender_id, 
          recipient_id,
          sender_name, 
          sender_company, 
          sender_avatar_url, 
          sender_is_recruiter, 
          subject, 
          preview, 
          content, 
          folder
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          faker.helpers.arrayElement(userIds),
          faker.helpers.arrayElement(userIds),
          faker.person.fullName(),
          faker.helpers.arrayElement(companyNames),
          faker.image.avatar(),
          faker.datatype.boolean(),
          faker.lorem.sentence(),
          faker.lorem.sentences(2),
          faker.lorem.paragraphs(2),
          faker.helpers.arrayElement(['inbox', 'sent', 'archived']),
        ]
      );
    }

    console.log(`✅ Seeded messages`);
  } catch (err) {
    console.error('❌ Error seeding messages:', err);
    throw err;
  }
}

async function seedJobs() {
  try {
    const { rows: companies } = await client.query(`SELECT id FROM companies`);
    const companyIds = companies.map(c => c.id);

    for (let i = 0; i < getRandomCount(); i++) {
      await client.query(
        `INSERT INTO jobs (
          title, 
          description, 
          company_id, 
          location, 
          salary_min, 
          salary_max, 
          salary_currency, 
          job_type, 
          is_remote, 
          posted_at, 
          updated_at, 
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW(), $10)`,
        [
          faker.person.jobTitle(),
          faker.lorem.paragraphs(2),
          faker.helpers.arrayElement(companyIds),
          faker.location.city(),
          faker.number.int({ min: 40000, max: 80000 }),
          faker.number.int({ min: 90000, max: 150000 }),
          'USD',
          faker.helpers.arrayElement(['Full-time', 'Part-time', 'Contract', 'Internship']),
          faker.datatype.boolean(),
          faker.helpers.arrayElement(['open', 'closed', 'draft']),
        ]
      );
    }

    console.log(`✅ Seeded jobs`);
  } catch (err) {
    console.error('❌ Error seeding jobs:', err);
    throw err;
  }
}

async function seedUserProfiles() {
  try {
    const { rows: users } = await client.query(`SELECT id, first_name FROM users`);
    const selectedUsers = users; // use first 30 users

    for (const user of selectedUsers) {
      await client.query(
        `INSERT INTO user_profiles (
          user_id,
          job_title,
          location,
          profile_image_url,
          profile_summary,
          professional_summary,
          years_of_experience,
          experience_level,
          primary_industry,
          profile_completion,
          website_url,
          linkedin_url,
          github_url,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,  NOW())`,
        [
          user.id,
          faker.person.jobTitle(),
          faker.location.city(),
          faker.image.avatar(),
          faker.lorem.paragraph(),
          faker.lorem.paragraphs(2),
          faker.number.int({ min: 0, max: 20 }),
          faker.helpers.arrayElement(['Entry', 'Mid', 'Senior', 'Lead']),
          faker.commerce.department(),
          faker.number.int({ min: 10, max: 100 }),
          faker.internet.url(),
          faker.internet.url(),
          faker.internet.url(),
        ]
      );
    }

    console.log(`✅ Seeded user profiles`);
  } catch (err) {
    console.error('❌ Error seeding user profiles:', err);
    throw err;
  }
}

async function seedUserDocuments() {
  try {
    const { rows: users } = await client.query(`SELECT id FROM users`);
    const userIds = users.map(u => u.id);

    for (let i = 0; i < getRandomCount(); i++) {
      await client.query(
        `INSERT INTO user_documents (
          user_id,
          document_type,
          file_name,
          storage_url,
          file_size_kb,
          is_default_resume,
          uploaded_at,
          description
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)`,
        [
          faker.helpers.arrayElement(userIds),
          faker.helpers.arrayElement(['resume', 'cover_letter', 'certificate', 'portfolio_link', 'other']), // from document_type enum
          faker.system.fileName(),
          faker.internet.url(),
          faker.number.int({ min: 100, max: 2048 }),
          faker.datatype.boolean(),
          faker.lorem.sentence(),
        ]
      );
    }

    console.log(`✅ Seeded user documents`);
  } catch (err) {
    console.error('❌ Error seeding user documents:', err);
    throw err;
  }
}


async function seedUserEducation() {
  try {
    const { rows: users } = await client.query(`SELECT id FROM users`);
    const userIds = users.map(u => u.id);

    for (const userId of userIds) {
      const recordsCount = faker.number.int({ min: 2, max: 4 }); // 2–4 records per user

      for (let i = 0; i < recordsCount; i++) {
        const endDate = faker.date.past({ years: 1 });
        const startDate = faker.date.past({ years: 8, refDate: endDate });

        await client.query(
          `INSERT INTO user_education (
            user_id,
            institution_name,
            degree,
            field_of_study,
            start_date,
            end_date,
            description,
            institution_logo_url,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
          [
            userId,
            faker.company.name() + ' University',
            faker.helpers.arrayElement(['BSc', 'BA', 'MSc', 'MBA', 'Diploma']),
            faker.helpers.arrayElement(['Computer Science', 'Business', 'Economics', 'Design', 'Engineering']),
            startDate.toISOString().split('T')[0],
            endDate.toISOString().split('T')[0],
            faker.lorem.sentence(),
            faker.image.avatarGitHub(),
          ]
        );
      }
    }

    console.log(`✅ Seeded user education`);
  } catch (err) {
    console.error('❌ Error seeding user education:', err);
    throw err;
  }
}
async function seedUserExperience() {
  try {
    const { rows: users } = await client.query(`SELECT id FROM users`);

    const userIds = users.map(u => u.id);

    for (let i = 0; i < getRandomCount(); i++) {
      // Generate dates ensuring start is before end
      const endDate = faker.date.recent();
      const startDate = faker.date.past({ years: 3, refDate: endDate });

      // Generate a random user_id from the list of users
      const userId = faker.helpers.arrayElement(userIds);

      await client.query(
        `INSERT INTO user_experience (
          user_id, 
          company_name, 
          job_title, 
          start_date, 
          end_date, 
          description
        )
        VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          userId,
          faker.company.name(),
          faker.person.jobTitle(),
          startDate.toISOString().split('T')[0],
          endDate.toISOString().split('T')[0],
          faker.lorem.sentences(2),
        ]
      );
    }

    console.log(`✅ Seeded user experience`);
  } catch (err) {
    console.error('❌ Error seeding user experience:', err);
    throw err;
  }
}

async function seedUserSkills() {
  try {
    const { rows: users } = await client.query(`SELECT id FROM users`);
    const { rows: skills } = await client.query(`SELECT id FROM skills`);

    const userIds = users.map(u => u.id);
    const skillIds = skills.map(s => s.id);

    // Track pairs to avoid duplicates
    const userSkillPairs = new Set<string>();

    for (let i = 0; i < getRandomCount()*3; i++) {
      const userId = faker.helpers.arrayElement(userIds);
      const skillId = faker.helpers.arrayElement(skillIds);
      const pairKey = `${userId}-${skillId}`;
      
      // Skip if this user-skill pair already exists
      if (userSkillPairs.has(pairKey)) {
        continue;
      }
      
      userSkillPairs.add(pairKey);
      
      await client.query(
        `INSERT INTO user_skills (user_id, skill_id, proficiency_level)
         VALUES ($1, $2, $3)`,
        [
          userId,
          skillId,
          faker.helpers.arrayElement(['beginner', 'intermediate', 'expert']),
        ]
      );
    }
    console.log(`✅ Seeded user skills`);
  } catch (err) {
    console.error('❌ Error seeding user skills:', err);
    throw err;
  }
}


async function seedPortfolioItems() {
  try {
    const { rows: users } = await client.query(`SELECT id FROM users`);

    const userIds = users.map(u => u.id);
    const technologies = ['JavaScript', 'TypeScript', 'React', 'Angular', 'Node.js', 'Python', 'Java', 'SQL', 'Docker', 'Kubernetes'];

    for (let i = 0; i < getRandomCount(); i++) {
      const userId = faker.helpers.arrayElement(userIds);
      const title = faker.lorem.words(3);
      const description = faker.lorem.sentences(2);
      const url = faker.internet.url();
      const imageUrl = faker.image.url();
      const techUsed = faker.helpers.arrayElements(technologies, faker.number.int({ min: 1, max: 5 }));

      await client.query(
        `INSERT INTO portfolio_items (user_id, title, description, project_url, image_url, technologies_used)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          userId,
          title,
          description,
          url,
          imageUrl,
          techUsed,
        ]
      );
    }
    console.log(`✅ Seeded portfolio items`);
  } catch (err) {
    console.error('❌ Error seeding portfolio items:', err);
    throw err;
  }
}

async function seedJobSkills() {
  try {
    const { rows: jobs } = await client.query(`SELECT id FROM jobs`);
    const { rows: skills } = await client.query(`SELECT id FROM skills`);

    const jobIds = jobs.map(j => j.id);
    const skillIds = skills.map(s => s.id);

    // Track pairs to avoid duplicates
    const jobSkillPairs = new Set<string>();

    for (let i = 0; i < jobIds.length; i++) {
      const jobId = jobIds[i];

      // Track the skills assigned to this job
      const jobSkills = new Set<number>();

      // Ensure each job gets at least 5 unique skills
      while (jobSkills.size < 5) {
        const skillId = faker.helpers.arrayElement(skillIds);
        
        // Add the skill if it's not already added for this job
        if (!jobSkills.has(skillId)) {
          jobSkills.add(skillId);
        }
      }

      // Insert each unique job-skill pair
      jobSkills.forEach(skillId => {
        const pairKey = `${jobId}-${skillId}`;

        // Skip if this job-skill pair already exists globally
        if (jobSkillPairs.has(pairKey)) {
          return;
        }

        jobSkillPairs.add(pairKey);

        client.query(
          `INSERT INTO job_skills (job_id, skill_id)
           VALUES ($1, $2)`,
          [jobId, skillId]
        );
      });
    }
    
    console.log(`✅ Seeded job skills`);
  } catch (err) {
    console.error('❌ Error seeding job skills:', err);
    throw err;
  }
}

async function seedSavedJobs() {
  try {
    const { rows: users } = await client.query(`SELECT id FROM users`);
    const { rows: jobs } = await client.query(`SELECT id FROM jobs`);

    const userIds = users.map(u => u.id);
    const jobIds = jobs.map(j => j.id);

    // Track pairs to avoid duplicates
    const savedJobPairs = new Set<string>();

    // For each user, randomly assign between 1 and 3 jobs to save
    for (let i = 0; i < userIds.length; i++) {
      const userId = userIds[i];

      // Determine how many jobs this user will save (between 1 and 3)
      const numSavedJobs = faker.number.int({ min: 1, max: 3 });

      // Track the job IDs saved for this user
      const savedJobsForUser = new Set<number>();

      while (savedJobsForUser.size < numSavedJobs) {
        const jobId = faker.helpers.arrayElement(jobIds);
        
        // Add job to the saved jobs set if not already added
        savedJobsForUser.add(jobId);
      }

      // Insert each unique user-job pair into the database
      savedJobsForUser.forEach(jobId => {
        const pairKey = `${userId}-${jobId}`;

        // Skip if this user-job pair already exists
        if (savedJobPairs.has(pairKey)) {
          return;
        }

        savedJobPairs.add(pairKey);

        client.query(
          `INSERT INTO saved_jobs (user_id, job_id, saved_at)
           VALUES ($1, $2, NOW())`,
          [userId, jobId]
        );
      });
    }

    console.log(`✅ Seeded saved jobs`);
  } catch (err) {
    console.error('❌ Error seeding saved jobs:', err);
    throw err;
  }
}

async function seedNotifications() {
  try {
    const { rows: users } = await client.query(`SELECT id FROM users`);
    const userIds = users.map(u => u.id);

    for (let i = 0; i < getRandomCount(); i++) {
      await client.query(
        `INSERT INTO notifications (user_id, type, title, description, link_url, is_read, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          faker.helpers.arrayElement(userIds),
          faker.helpers.arrayElement(['system', 'alert', 'reminder', 'message']),
          faker.lorem.sentence(),
          faker.lorem.paragraph(),
          faker.internet.url(),
          faker.datatype.boolean(),
        ]
      );
    }

    console.log(`✅ Seeded notifications`);
  } catch (err) {
    console.error('❌ Error seeding notifications:', err);
    throw err;
  }
}


async function seedMessageAttachments() {
  try {
    // Track pairs to avoid duplicates
    const messageAttachmentPairs = new Set<string>();

    // Fetch all message_ids from the messages table
    const { rows: messages } = await client.query(
      `SELECT id FROM messages`
    );

    // Extract message_ids
    const messageIds = messages.map((message: { id: number }) => message.id);

    for (let i = 0; i < 30; i++) {
      // Pick a random message_id from the existing messages in the database
      const messageId = faker.helpers.arrayElement(messageIds);

      // Pick a random document_id from the user_documents table
      const documentId = faker.number.int({ min: 1, max: 30 }); // Assuming there are 30 documents

      const pairKey = `${messageId}-${documentId}`;

      // Skip if this message-document pair already exists
      if (messageAttachmentPairs.has(pairKey)) {
        continue;
      }

      messageAttachmentPairs.add(pairKey);

      await client.query(
        `INSERT INTO message_attachments (message_id, document_id)
         VALUES ($1, $2)`,
        [messageId, documentId]
      );
    }

    console.log(`✅ Seeded message attachments`);
  } catch (err) {
    console.error('❌ Error seeding message attachments:', err);
    throw err;
  }
}


async function seedMessageLabelJunction() {
  try {
    // Track pairs to avoid duplicates
    const messageLabelPairs = new Set<string>();
    
    // Fetch message IDs and label IDs
    const messageIds = await client.query('SELECT id FROM messages');
    const labelIds = await client.query('SELECT id FROM message_labels');
    
    for (let i = 0; i < 40; i++) {
      const messageId = faker.helpers.arrayElement(messageIds.rows).id;
      const labelId = faker.helpers.arrayElement(labelIds.rows).id;
      const pairKey = `${messageId}-${labelId}`;
      
      // Skip if this message-label pair already exists
      if (messageLabelPairs.has(pairKey)) {
        continue;
      }
      
      messageLabelPairs.add(pairKey);
      
      await client.query(
        `INSERT INTO message_label_junction (message_id, label_id)
         VALUES ($1, $2)`,
        [messageId, labelId]
      );
    }
    console.log(`✅ Seeded message label junction`);
  } catch (err) {
    console.error('❌ Error seeding message label junction:', err);
    throw err;
  }
}
async function seedJobApplications() {
  try {
    // Track pairs to avoid duplicates
    const jobApplicationPairs = new Set<string>();

    for (let i = 0; i < 40; i++) {
      // Fetch random job and user IDs from their respective tables
      const jobIdQuery = await client.query('SELECT id FROM jobs ORDER BY RANDOM() LIMIT 1');
      const jobId = jobIdQuery.rows[0].id;

      const userIdQuery = await client.query('SELECT id FROM users ORDER BY RANDOM() LIMIT 1');
      const userId = userIdQuery.rows[0].id;

      const pairKey = `${jobId}-${userId}`;

      // Skip if this job-user pair already exists
      if (jobApplicationPairs.has(pairKey)) {
        continue;
      }

      jobApplicationPairs.add(pairKey);

      // Generate random resume and cover letter URLs (using faker)
      const resumeUrl = faker.internet.url();
      const coverLetterUrl = faker.internet.url();
      const notes = faker.lorem.sentences(2); // Random notes

      // Insert job application record
      await client.query(
        `INSERT INTO job_applications (job_id, user_id, status, application_date, notes, resume_url, cover_letter_url)
         VALUES ($1, $2, $3, NOW(), $4, $5, $6)`,
        [
          jobId,
          userId,
          faker.helpers.arrayElement(['applied', 'viewed', 'interviewing', 'offered', 'rejected', 'withdrawn']),
          notes,
          resumeUrl,
          coverLetterUrl,
        ]
      );
    }
    console.log(`✅ Seeded job applications`);
  } catch (err) {
    console.error('❌ Error seeding job applications:', err);
    throw err;
  }
}


async function seedInterviews() {
  try {
    for (let i = 0; i < getRandomCount(); i++) {
      const userIdQuery = await client.query('SELECT id FROM users ORDER BY RANDOM() LIMIT 1');
      const userId = userIdQuery.rows[0].id;

      const jobIdQuery = await client.query('SELECT id FROM jobs ORDER BY RANDOM() LIMIT 1');
      const jobId = jobIdQuery.rows[0].id;

      const companyNameResult = await client.query(`SELECT name FROM companies ORDER BY RANDOM() LIMIT 1`);
      const companyName = companyNameResult.rows[0].name.slice(0, 255);

      const companyLogoUrl = faker.image.url().slice(0, 512);
      const companyLocation = faker.location.city().slice(0, 255);
      const position = faker.person.jobTitle().slice(0, 255);
      const interviewType = faker.helpers.arrayElement(['phone', 'video', 'onsite', 'technical', 'behavioral']);
      const status = faker.helpers.arrayElement(['scheduled', 'completed', 'rescheduled', 'cancelled']);
      const interviewDate = faker.date.future().toISOString();
      const durationMinutes = faker.number.int({ min: 30, max: 180 });
      const notes = faker.lorem.sentences(2);
      const feedback = faker.lorem.sentences(3);
      const preparation = faker.lorem.sentences(3);

      await client.query(
        `INSERT INTO interviews (
          user_id, job_id, company_name, company_logo_url, company_location, position,
          interview_type, status, interview_date, duration_minutes, notes, feedback, preparation,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11, $12, $13,
          NOW(), NOW()
        )`,
        [
          userId,
          jobId,
          companyName,
          companyLogoUrl,
          companyLocation,
          position,
          interviewType,
          status,
          interviewDate,
          durationMinutes,
          notes,
          feedback,
          preparation,
        ]
      );
    }

    console.log(`✅ Seeded interviews`);
  } catch (err) {
    console.error('❌ Error seeding interviews:', err);
    throw err;
  }
}



async function seedLearningNotes() {
  try {
    for (let i = 0; i < 30; i++) {
      // Fetch random resource_id from the learning_resources table
      const resourceIdQuery = await client.query('SELECT id FROM learning_resources ORDER BY RANDOM() LIMIT 1');
      const resourceId = resourceIdQuery.rows[0].id;

      const content = faker.lorem.sentences(2);

      // Insert learning note
      await client.query(
        `INSERT INTO learning_notes (resource_id, content, created_at, updated_at)
         VALUES ($1, $2, NOW(), NOW())`,
        [resourceId, content]
      );
    }
    console.log(`✅ Seeded learning notes`);
  } catch (err) {
    console.error('❌ Error seeding learning notes:', err);
    throw err;
  }
}

async function seedInterviewFollowups() {
  try {
    // Fetch up to 20 unique interview IDs
    const res = await client.query(`SELECT id FROM interviews ORDER BY RANDOM() LIMIT 20`);
    const interviewIds = res.rows.map(row => row.id);

    for (const interviewId of interviewIds) {
      await client.query(
        `INSERT INTO interview_followups (interview_id, sent, followup_date, content)
         VALUES ($1, $2, $3, $4)`,
        [
          interviewId,
          faker.datatype.boolean(),
          faker.date.future().toISOString(),
          faker.lorem.sentences(2),
        ]
      );
    }

    console.log(`✅ Seeded interview followups`);
  } catch (err) {
    console.error('❌ Error seeding interview followups:', err);
    throw err;
  }
}


async function seedInterviewQuestions() {
  try {
    // Fetch all interview IDs
    const res = await client.query(`SELECT id FROM interviews`);
    const interviewIds = res.rows.map(row => row.id);

    if (interviewIds.length === 0) {
      console.warn('⚠️ No interviews found to attach questions to.');
      return;
    }

    for (let i = 0; i < 25; i++) {
      const randomInterviewId = faker.helpers.arrayElement(interviewIds);

      await client.query(
        `INSERT INTO interview_questions (interview_id, question, notes, answered)
         VALUES ($1, $2, $3, $4)`,
        [
          randomInterviewId,
          faker.lorem.sentence(),
          faker.lorem.sentences(2),
          faker.datatype.boolean(),
        ]
      );
    }

    console.log(`✅ Seeded interview questions`);
  } catch (err) {
    console.error('❌ Error seeding interview questions:', err);
    throw err;
  }
}


async function seedInterviewers() {
  try {
    // Get all interview IDs from the database
    const res = await client.query(`SELECT id FROM interviews`);
    const interviewIds = res.rows.map(row => row.id);

    if (interviewIds.length === 0) {
      console.warn('⚠️ No interviews found to attach interviewers to.');
      return;
    }

    for (let i = 0; i < 20; i++) {
      const randomInterviewId = faker.helpers.arrayElement(interviewIds);

      await client.query(
        `INSERT INTO interviewers (interview_id, name, title, avatar_url, linkedin_url, notes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          randomInterviewId,
          faker.person.fullName(),
          faker.person.jobTitle(),
          faker.image.avatar(),
          faker.internet.url(),
          faker.lorem.sentences(2),
        ]
      );
    }

    console.log(`✅ Seeded interviewers`);
  } catch (err) {
    console.error('❌ Error seeding interviewers:', err);
    throw err;
  }
}



async function seedInterviewDocuments() {
  try {
    // Track pairs to avoid duplicates
    const interviewDocumentPairs = new Set<string>();
    
    for (let i = 0; i < 20; i++) {
      const interviewId = faker.number.int({ min: 1, max: 30 });
      const documentId = faker.number.int({ min: 1, max: 30 });
      const pairKey = `${interviewId}-${documentId}`;
      
      // Skip if this interview-document pair already exists
      if (interviewDocumentPairs.has(pairKey)) {
        continue;
      }
      
      interviewDocumentPairs.add(pairKey);
      
      await client.query(
        `INSERT INTO interview_documents (interview_id, document_id)
         VALUES ($1, $2)`,
        [interviewId, documentId]
      );
    }
    console.log(`✅ Seeded interview documents`);
  } catch (err) {
    console.error('❌ Error seeding interview documents:', err);
    throw err;
  }
}




seed();