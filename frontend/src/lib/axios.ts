import axios from 'axios';
import toast from 'react-hot-toast';

// Desktop/offline builds use the bundled local Laravel server under /api.
// Development may set VITE_API_URL=http://localhost:8080/api if needed.
const configuredBaseUrl = (import.meta.env.VITE_API_URL || '').trim();
const localBaseUrl = typeof window !== 'undefined' ? `${window.location.origin}/api` : '/api';
const apiBaseUrl = configuredBaseUrl || localBaseUrl;
// Sanctum's CSRF-cookie route lives outside /api, at the same origin.
const rootBaseUrl = apiBaseUrl.replace(/\/api\/?$/, '');

// Local-only POS: all requests go to the bundled PHP server on 127.0.0.1:8080.
// Timeout is generous because the machine may be busy (background indexing, etc.).
const api = axios.create({
  baseURL: apiBaseUrl,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  timeout: 15000,
  // Auth is an httpOnly session cookie, not a Bearer token — the browser
  // attaches it automatically. withXSRFToken is needed because in dev the
  // SPA (5173) and API (8080) are different origins.
  withCredentials: true,
  withXSRFToken: true,
});

// Sanctum's SPA auth requires priming the XSRF-TOKEN cookie before the first
// state-changing request (i.e. before login) can pass CSRF verification.
export const primeCsrf = () => axios.get(`${rootBaseUrl}/sanctum/csrf-cookie`, { withCredentials: true });

api.interceptors.response.use(
  (res) => res,
  (error) => {
    // Expired license: the server keeps the app read-only. Say so once, rather than
    // letting every blocked save look like a random failure.
    if (error.response?.status === 402 && error.response?.data?.code === 'LICENSE_EXPIRED') {
      toast.error(error.response.data.message, { id: 'license-expired' });
    }
    if (error.response?.status === 401) {
      localStorage.removeItem('auth-storage');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
