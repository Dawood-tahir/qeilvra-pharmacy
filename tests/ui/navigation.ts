const router = {
  push: (url: string) => location.assign(url),
  replace: (url: string) => location.replace(url),
  refresh: () => {},
};
export function useRouter() { return router; }
export function usePathname() { return location.pathname; }
export function useSearchParams() { return new URLSearchParams(location.search); }
export function notFound(): never { throw new Error("Fixture record not found"); }
