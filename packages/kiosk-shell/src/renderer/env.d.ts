// Vite handles these imports itself: CSS is bundled, an .svg import becomes its URL.
declare module "*.css";
declare module "*.svg" {
  const url: string;
  export default url;
}
