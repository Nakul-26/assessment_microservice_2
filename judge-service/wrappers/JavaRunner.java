import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;
import javax.tools.JavaCompiler;
import javax.tools.ToolProvider;
import java.io.File;
import java.io.FileWriter;
import java.lang.reflect.Method;
import java.net.URL;
import java.net.URLClassLoader;
import java.util.Map;

public class JavaRunner {
    public static void main(String[] args) {
        if (args.length < 1) {
            System.err.println("Usage: java JavaRunner <inputJson>");
            return;
        }

        String inputJson = args[0];
        Gson gson = new Gson();

        try {
            Map<String, Object> inputMap = gson.fromJson(inputJson, new TypeToken<Map<String, Object>>() {}.getType());
            String code = (String) inputMap.get("code");
            String functionName = (String) inputMap.get("functionName");
            Map<String, Object> input = (Map<String, Object>) inputMap.get("input");

            // Save the user's code to a .java file
            File sourceFile = new File("Solution.java");
            try (FileWriter writer = new FileWriter(sourceFile)) {
                writer.write(code);
            }

            // Compile the .java file
            JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
            int compilationResult = compiler.run(null, null, null, sourceFile.getPath());
            if (compilationResult != 0) {
                System.err.println("Compilation failed.");
                return;
            }

            // Load the compiled class
            URLClassLoader classLoader = URLClassLoader.newInstance(new URL[]{new File("").toURI().toURL()});
            Class<?> solutionClass = Class.forName("Solution", true, classLoader);
            Object solutionInstance = solutionClass.getDeclaredConstructor().newInstance();

            // Find the method
            Method method = null;
            for (Method m : solutionClass.getMethods()) {
                if (m.getName().equals(functionName)) {
                    method = m;
                    break;
                }
            }

            if (method == null) {
                System.err.println("Method not found: " + functionName);
                return;
            }

            // Prepare arguments
            Object[] params = new Object[method.getParameterCount()];
            java.lang.reflect.Parameter[] methodParameters = method.getParameters();
            for (int i = 0; i < method.getParameterCount(); i++) {
                String paramName = methodParameters[i].getName();
                Object value = input.get(paramName);
                params[i] = gson.fromJson(gson.toJson(value), methodParameters[i].getType());
            }

            // Invoke the method
            Object result = method.invoke(solutionInstance, params);
            System.out.println(gson.toJson(result));

        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}