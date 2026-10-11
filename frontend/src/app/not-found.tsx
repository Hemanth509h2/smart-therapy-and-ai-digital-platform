import ErrorScreen from '@/components/ErrorScreen';

// Rendered for any URL that doesn't match a page, and wherever notFound() is called.
export default function NotFound() {
  return (
    <ErrorScreen
      code="404"
      title="Page not found"
      message="The page you're looking for doesn't exist or has been moved."
    />
  );
}
