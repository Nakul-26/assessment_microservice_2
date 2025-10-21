export default {
  id: "python",
  image: "python:3.11-alpine",
  fileExt: ".py",
  // command args array to run the file inside container
  runCmd: (fileName) => ["python", fileName],
  wrapperTemplate: "python_wrapper.tpl" // file in src/wrappers
};
