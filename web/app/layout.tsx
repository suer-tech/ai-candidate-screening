import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { THEME_BOOTSTRAP_SCRIPT } from "./theme-preference";

export async function generateMetadata(): Promise<Metadata> {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host") ?? "localhost:3000";
  const protocol = headerStore.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "Правильный выбор — AI-скриннинг кандидатов";
  const description = "AI-скринер кандидатов: вакансии, рейтинг, доказательства и оперативная очередь для HR-команды.";
  return {
    title,
    description,
    icons: { icon: "/company-logo.png", shortcut: "/company-logo.png", apple: "/company-logo.png" },
    openGraph: { title, description, type: "website", url: origin, images: [{ url: `${origin}/og.png`, width: 1536, height: 1024, alt: "Правильный выбор — AI-скриннинг кандидатов" }] },
    twitter: { card: "summary_large_image", title, description, images: [`${origin}/og.png`] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} /></head><body>{children}</body></html>;
}
