// Frontend auth utility
const Auth = {
  // Check if user is logged in
  checkAuth: async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (!res.ok) return { success: false };
      return await res.json();
    } catch (err) {
      return { success: false };
    }
  },

  // Handle redirect if already logged in (for login/register pages)
  redirectIfLoggedIn: async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        window.location.replace('/chat');
      }
    } catch (err) {}
  }
};

window.Auth = Auth;
