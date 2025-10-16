import { InspectorDashboard } from '@/components/client/InspectorDashboard'
import { Layout } from '@/components/client/Layout'
import { ServerDetail } from '@/components/client/ServerDetail'
import { ServerList } from '@/components/client/ServerList'
import { Toaster } from '@/components/ui/sonner'
import { Route, BrowserRouter as Router, Routes } from 'react-router-dom'
import { McpProvider } from './context/McpContext'
import { ThemeProvider } from './context/ThemeContext'

function App() {
  return (
    <ThemeProvider>
      <McpProvider>
        <Router basename="/inspector">
          <Layout>
            <Routes>
              <Route path="/" element={<InspectorDashboard />} />
              <Route path="/servers" element={<ServerList />} />
              <Route path="/servers/:serverId" element={<ServerDetail />} />
            </Routes>
          </Layout>
        </Router>
        <Toaster position="top-center" />
      </McpProvider>
    </ThemeProvider>
  )
}

export default App
