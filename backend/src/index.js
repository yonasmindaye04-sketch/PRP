import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { pool } from './config/database.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

import authRoutes from './routes/authRoutes.js';
import productRoutes from './routes/productRoutes.js';
import salesRoutes from './routes/salesRoutes.js';
import purchaseRoutes from './routes/purchaseRoutes.js';
import returnRoutes from './routes/returnRoutes.js';
import financeRoutes from './routes/financeRoutes.js';
import userRoutes from './routes/userRoutes.js';
import masterRoutes from './routes/masterRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';

dotenv.config();

const app = express();

// Security middleware
app.use(helmet());

// CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Pharmacy ERP API is running',
    timestamp: new Date().toISOString()
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api', productRoutes);
app.use('/api', salesRoutes);
app.use('/api', purchaseRoutes);
app.use('/api', returnRoutes);
app.use('/api', financeRoutes);
app.use('/api', userRoutes);
app.use('/api', masterRoutes);
app.use('/api', dashboardRoutes);

// 404 handler
app.use(notFoundHandler);

// Error handler
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

const start = async () => {
  try {
    // Test database connection
    await pool.query('SELECT NOW()');
    console.log('Database connected successfully');
    
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`API health check: http://localhost:${PORT}/api/health`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
};

start();