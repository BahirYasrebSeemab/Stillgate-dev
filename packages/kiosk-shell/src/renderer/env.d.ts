// Vite handles these imports itself: CSS is bundled, an image import becomes its URL.
declare module "*.css";
declare module "*.png" {
  const url: string;
  export default url;
}
