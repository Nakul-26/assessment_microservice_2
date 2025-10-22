export default {
  id: "java",
  image: "openjdk:17-jdk-alpine",
  fileExt: ".java",
  runCmd: (fileName, args) => ["sh", "-c", `javac ${fileName} && java ${fileName.replace('.java', '')} ${args.join(' ')}`],
  wrapperTemplate: "java_wrapper.tpl"
};
