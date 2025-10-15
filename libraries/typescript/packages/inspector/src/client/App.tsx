import { Route, BrowserRouter as Router, Routes } from 'react-router-dom'
import { InspectorDashboard } from './components/InspectorDashboard'
import { Layout } from './components/Layout'
import { ServerDetail } from './components/ServerDetail'
import { ServerList } from './components/ServerList'
import { McpProvider } from './context/McpContext'
import { ThemeProvider } from './context/ThemeContext'
import { Toaster } from '@/components/ui/sonner'

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
