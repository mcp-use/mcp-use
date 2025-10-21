import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

interface Task {
  id: string
  title: string
  description: string
  status: 'todo' | 'in-progress' | 'done'
  priority: 'low' | 'medium' | 'high'
  assignee?: string
}

interface KanbanBoardProps {
  initialTasks?: Task[]
}

const KanbanBoard: React.FC<KanbanBoardProps> = ({ initialTasks = [] }) => {
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [newTask, setNewTask] = useState({ title: '', description: '', priority: 'medium' as Task['priority'] })

  // Load tasks from URL parameters or use defaults
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const tasksParam = urlParams.get('tasks')

    if (tasksParam) {
      try {
        const parsedTasks = JSON.parse(decodeURIComponent(tasksParam))
        setTasks(parsedTasks)
      }
      catch (error) {
        console.error('Error parsing tasks from URL:', error)
      }
    }
    else {
      // Default tasks for demo
      setTasks([
        { id: '1', title: 'Design UI mockups', description: 'Create wireframes for the new dashboard', status: 'todo', priority: 'high', assignee: 'Alice' },
        { id: '2', title: 'Implement authentication', description: 'Add login and registration functionality', status: 'in-progress', priority: 'high', assignee: 'Bob' },
        { id: '3', title: 'Write documentation', description: 'Document the API endpoints', status: 'done', priority: 'medium', assignee: 'Charlie' },
        { id: '4', title: 'Setup CI/CD', description: 'Configure automated testing and deployment', status: 'todo', priority: 'medium' },
        { id: '5', title: 'Code review', description: 'Review pull requests from the team', status: 'in-progress', priority: 'low', assignee: 'David' },
      ])
    }
  }, [])

  const addTask = () => {
    if (newTask.title.trim()) {
      const task: Task = {
        id: Date.now().toString(),
        title: newTask.title,
        description: newTask.description,
        status: 'todo',
        priority: newTask.priority,
      }
      setTasks([...tasks, task])
      setNewTask({ title: '', description: '', priority: 'medium' })
    }
  }

  const moveTask = (taskId: string, newStatus: Task['status']) => {
    setTasks(tasks.map(task =>
      task.id === taskId ? { ...task, status: newStatus } : task,
    ))
  }

  const deleteTask = (taskId: string) => {
    setTasks(tasks.filter(task => task.id !== taskId))
  }

  const getTasksByStatus = (status: Task['status']) => {
    return tasks.filter(task => task.status === status)
  }

  const getPriorityColor = (priority: Task['priority']) => {
    switch (priority) {
      case 'high': return '#ff4757'
      case 'medium': return '#ffa502'
      case 'low': return '#2ed573'
      default: return '#57606f'
    }
  }

  const columns = [
    { id: 'todo', title: 'To Do', color: '#57606f' },
    { id: 'in-progress', title: 'In Progress', color: '#ffa502' },
    { id: 'done', title: 'Done', color: '#2ed573' },
  ] as const

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ marginBottom: '30px' }}>
        <h1 style={{ margin: '0 0 20px 0', color: '#2c3e50' }}>Kanban Board</h1>

        {/* Add new task form */}
        <div style={{
          background: 'white',
          padding: '20px',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          marginBottom: '20px',
        }}
        >
          <h3 style={{ margin: '0 0 15px 0' }}>Add New Task</h3>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Task title"
              value={newTask.title}
              onChange={e => setNewTask({ ...newTask, title: e.target.value })}
              style={{
                padding: '8px 12px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                flex: '1',
                minWidth: '200px',
              }}
            />
            <input
              type="text"
              placeholder="Description"
              value={newTask.description}
              onChange={e => setNewTask({ ...newTask, description: e.target.value })}
              style={{
                padding: '8px 12px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                flex: '1',
                minWidth: '200px',
              }}
            />
            <select
              title="Priority"
              value={newTask.priority}
              onChange={e => setNewTask({ ...newTask, priority: e.target.value as Task['priority'] })}
              style={{
                padding: '8px 12px',
                border: '1px solid #ddd',
                borderRadius: '4px',
              }}
            >
              <option value="low">Low Priority</option>
              <option value="medium">Medium Priority</option>
              <option value="high">High Priority</option>
            </select>
            <button
              onClick={addTask}
              style={{
                padding: '8px 16px',
                background: '#3498db',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Add Task
            </button>
          </div>
        </div>
      </div>

      {/* Kanban columns */}
      <div style={{ display: 'flex', gap: '20px', overflowX: 'auto' }}>
        {columns.map(column => (
          <div
            key={column.id}
            style={{
              flex: '1',
              minWidth: '300px',
              background: 'white',
              borderRadius: '8px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                background: column.color,
                color: 'white',
                padding: '15px 20px',
                fontWeight: 'bold',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>{column.title}</span>
              <span style={{
                background: 'rgba(255,255,255,0.2)',
                padding: '4px 8px',
                borderRadius: '12px',
                fontSize: '12px',
              }}
              >
                {getTasksByStatus(column.id).length}
              </span>
            </div>

            <div style={{ padding: '20px', minHeight: '400px' }}>
              {getTasksByStatus(column.id).map(task => (
                <div
                  key={task.id}
                  style={{
                    background: '#f8f9fa',
                    border: '1px solid #e9ecef',
                    borderRadius: '6px',
                    padding: '15px',
                    marginBottom: '10px',
                    cursor: 'grab',
                  }}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', task.id)
                  }}
                  onDragOver={e => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    const taskId = e.dataTransfer.getData('text/plain')
                    if (taskId === task.id) {
                      // Move to next column
                      const currentIndex = columns.findIndex(col => col.id === column.id)
                      const nextColumn = columns[currentIndex + 1]
                      if (nextColumn) {
                        moveTask(taskId, nextColumn.id)
                      }
                    }
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <h4 style={{ margin: '0', color: '#2c3e50' }}>{task.title}</h4>
                    <button
                      onClick={() => deleteTask(task.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#e74c3c',
                        cursor: 'pointer',
                        fontSize: '16px',
                      }}
                    >
                      ×
                    </button>
                  </div>

                  {task.description && (
                    <p style={{ margin: '0 0 10px 0', color: '#6c757d', fontSize: '14px' }}>
                      {task.description}
                    </p>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div
                      style={{
                        background: getPriorityColor(task.priority),
                        color: 'white',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '12px',
                        fontWeight: 'bold',
                      }}
                    >
                      {task.priority.toUpperCase()}
                    </div>

                    {task.assignee && (
                      <span style={{
                        background: '#e9ecef',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '12px',
                        color: '#495057',
                      }}
                      >
                        {task.assignee}
                      </span>
                    )}
                  </div>
                </div>
              ))}

              {getTasksByStatus(column.id).length === 0 && (
                <div style={{
                  textAlign: 'center',
                  color: '#6c757d',
                  padding: '40px 20px',
                  fontStyle: 'italic',
                }}
                >
                  No tasks in this column
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Mount the component
const container = document.getElementById('widget-root')
if (container) {
  const root = createRoot(container)
  root.render(<KanbanBoard />)
}
