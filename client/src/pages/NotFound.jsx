import { Link } from 'react-router-dom';
import { ArrowLeft, Compass } from 'lucide-react';
import { EmptyState } from '../components/ui.jsx';

export default function NotFound() {
  return (
    <div className="page">
      <EmptyState
        icon={<Compass size={24} />}
        title="Page not found"
        description="That route does not exist in emuman. It may have moved or the machine was deleted."
        action={
          <Link className="btn btn-primary" to="/">
            <ArrowLeft size={14} /> Back to dashboard
          </Link>
        }
      />
    </div>
  );
}
