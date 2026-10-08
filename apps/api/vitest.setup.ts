export const setup = () => {
  import('vitest').then(({ enableGlobalAPI }) => {
    enableGlobalAPI();
  });
};
