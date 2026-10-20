import { lazy, Suspense, type ComponentType } from "react";

// The fixture server runs outside the Next.js compiler. Use React's native lazy
// loader so the actual production chart components render in browser tests.
export default function dynamic<Props extends object>(
  loader: () => Promise<ComponentType<Props> | { default: ComponentType<Props> }>,
  options: { ssr?: boolean; loading?: ComponentType } = {},
) {
  const Component = lazy(async () => {
    const loaded = await loader();
    return { default: typeof loaded === "function" ? loaded : loaded.default };
  });
  const Loading = options.loading;
  return function FixtureDynamic(props: Props) {
    return <Suspense fallback={Loading ? <Loading /> : null}><Component {...props} /></Suspense>;
  };
}
