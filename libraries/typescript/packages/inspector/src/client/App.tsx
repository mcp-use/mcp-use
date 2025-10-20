import { Route, BrowserRouter as Router, Routes } from 'react-router-dom'
import { InspectorDashboard } from '@/client/components/InspectorDashboard'
import { Layout } from '@/client/components/Layout'
import { Toaster } from '@/client/components/ui/sonner'
import { InspectorProvider } from './context/InspectorContext'
import { McpProvider } from './context/McpContext'
import { ThemeProvider } from './context/ThemeContext'

function App() {
  return (
    <ThemeProvider>
      <McpProvider>
        <InspectorProvider>
          <Router basename="/inspector">
            <Layout>
              <Routes>
                <Route path="/" element={<InspectorDashboard />} />
              </Routes>
            </Layout>
          </Router>
          <Toaster position="top-center" />
        </InspectorProvider>
      </McpProvider>
    </ThemeProvider>
  )
}

export default App
