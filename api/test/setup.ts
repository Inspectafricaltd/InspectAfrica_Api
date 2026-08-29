// API test setup
import { vi } from 'vitest';

// Mock environment variables
process.env.JWT_SECRET = 'test-secret';
process.env.WP_BASE_URL = 'http://localhost:8080';
process.env.WP_API_KEY = 'test-wp-key';
