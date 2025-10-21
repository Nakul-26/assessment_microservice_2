export default {
  id: "javascript",
  image: "node:20-alpine",
  fileExt: ".js",
  runCmd: (filePath) => ["node", filePath],
  wrapperTemplate: "js_wrapper.tpl"
};
