import { Sidebar } from "@/components/sidebar";
import { LocaleProvider } from "@/lib/i18n-context";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <LocaleProvider>
      <Sidebar>{children}</Sidebar>
    </LocaleProvider>
  );
}
