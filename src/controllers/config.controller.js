export const ConfigController = {
  getConfig: (req, res) => {
    res.json({
      minVersion: "0.0.6",
      forceUpdate: false,
      storeUrl: {
        android: "https://play.google.com/store/apps/details?id=com.animatedsticker.aistickers",
        ios: "https://apps.apple.com/app/id000000000"
      }
    });
  }
};
