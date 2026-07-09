import axios from 'axios';

// Desktop/offline builds use the bundled local Laravel server under /api.
// Development may set VITE_API_URL=http://localhost:8080/api if needed.
const configuredBaseUrl = (import.meta.env.VITE_API_URL || '').trim();
const localBaseUrl = typeof window !== 'undefined' ? `${window.location.origin}/api` : '/api';

// Local-only POS: all requests go to the bundled PHP server on 127.0.0.1:8080.
// Timeout is generous because the machine may be busy (background indexing, etc.).
const api = axios.create({
  baseURL: configuredBaseUrl || localBaseUrl,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('auth-storage');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
