import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { BookingPage } from './booking/BookingPage';
import { HomePage } from './home/HomePage';
import { SalonLayout } from './components/SalonLayout';
import { Home } from './Home';
import { I18nProvider } from './lib/i18n';
import { Impressum, Privacy } from './legal/Legal';
import { ManagePage } from './manage/ManagePage';
import { RouteError, SalonAdminRedirect } from './NotFound';
import { UnsubscribePage } from './manage/UnsubscribePage';
import './styles.css';

// Staff and admin code is only downloaded by staff (keeps the client booking page small).
const StaffApp = lazy(() => import('./staff/StaffApp'));
const PlatformAdmin = lazy(() => import('./admin/PlatformAdmin'));
const lazyEl = (el: React.ReactNode) => <Suspense fallback={<div className="spin" />}>{el}</Suspense>;

const router = createBrowserRouter([
  { path: '/', element: <Home />, errorElement: <RouteError /> },
  { path: '/admin/*', element: lazyEl(<PlatformAdmin />), errorElement: <RouteError /> },
  {
    path: '/:slug',
    element: <SalonLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'buchen', element: <BookingPage /> },
      { path: 'termin/:token', element: <ManagePage /> },
      { path: 'abmelden/:token', element: <UnsubscribePage /> },
      { path: 'impressum', element: <Impressum /> },
      { path: 'datenschutz', element: <Privacy /> },
      { path: 'team/*', element: lazyEl(<StaffApp />) },
      { path: 'admin', element: <SalonAdminRedirect /> },
    ],
  },
]);

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider locale="de">
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nProvider>
  </StrictMode>,
);
