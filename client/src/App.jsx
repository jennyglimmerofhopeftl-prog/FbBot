import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Layout from './pages/Layout.jsx';
import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Inbox from './pages/Inbox.jsx';
import MyChats from './pages/MyChats.jsx';
import Agents from './pages/Agents.jsx';
import Channels from './pages/Channels.jsx';

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// Agents ko /agents aur /channels ka access nahi - sirf admin/owner ke liye.
function StaffOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'agent') return <Navigate to="/my-chats" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/my-chats" element={<MyChats />} />
        <Route path="/agents" element={<StaffOnly><Agents /></StaffOnly>} />
        <Route path="/channels" element={<StaffOnly><Channels /></StaffOnly>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}