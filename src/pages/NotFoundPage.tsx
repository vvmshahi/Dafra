import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'

export default function NotFoundPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <h1 className="text-7xl font-bold text-primary-600 mb-4">404</h1>
      <p className="text-xl text-gray-700 mb-2">Page not found</p>
      <p className="text-gray-400 mb-8">The page you are looking for does not exist.</p>
      <Link to="/dashboard">
        <Button>Go to Dashboard</Button>
      </Link>
    </div>
  )
}
