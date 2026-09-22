import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { DeskShell } from "@/components/desk-shell";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { DEFAULT_DESCRIPTION, DEFAULT_OG_IMAGE, SITE_URL } from "@/lib/seo";
import appCss from "../styles.css?url";

const APP_NAME = "Keystone Beat";

const themeBootScript = `(() => {
  try {
    const stored = localStorage.getItem("keystone-beat-theme");
    const choice = stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
    const theme = choice === "system"
      ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : choice;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themeChoice = choice;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0a0e16" : "#f4f7fa");
  } catch {}
})();`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: `${APP_NAME} — Pennsylvania sports` },
      {
        name: "description",
        content: DEFAULT_DESCRIPTION,
      },
      { name: "robots", content: "index,follow" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: APP_NAME },
      { property: "og:title", content: `${APP_NAME} — Pennsylvania sports` },
      { property: "og:description", content: DEFAULT_DESCRIPTION },
      { property: "og:url", content: SITE_URL },
      { property: "og:image", content: DEFAULT_OG_IMAGE },
      { property: "og:image:alt", content: "Keystone Beat Pennsylvania sports" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: `${APP_NAME} — Pennsylvania sports` },
      { name: "twitter:description", content: DEFAULT_DESCRIPTION },
      { name: "twitter:image", content: DEFAULT_OG_IMAGE },
      { name: "theme-color", content: "#0a0e16" },
    ],
    links: [
      { rel: "icon", type: "image/png", href: "/brand/two-hounds-mark.png" },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: import.meta.env.VITE_STANDALONE === "true" ? "/manifest.webmanifest" : "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/brand/two-hounds-mark.png" },
      { rel: "canonical", href: SITE_URL },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Source+Sans+3:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap",
      },
    ],
  }),
  component: () => (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="bg-bg text-fg antialiased">
        {import.meta.env.VITE_STANDALONE !== "true" ? <PreviewHostBridge /> : null}
        {import.meta.env.VITE_STANDALONE === "true" ? <DeskShell><Outlet /></DeskShell> : <AuthProvider>
          <DeskShell>
            <Outlet />
          </DeskShell>
        </AuthProvider>}
        <Scripts />
      </body>
    </html>
  ),
});
