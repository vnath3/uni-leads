import "./globals.css";

export const metadata = {
  title: "Super Admin Dashboard",
  description: "Multi-tenant Supabase super admin console"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
