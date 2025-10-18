
import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;
import java.io.FileReader;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public class JavaRunner {
    public static void main(String[] args) {
        if (args.length < 2) {
            System.err.println("Usage: java JavaRunner <functionName> <jsonInput>");
            return;
        }

        String functionName = args[0];
        String jsonInput = args[1];
        Gson gson = new Gson();

        try {
            Solution solution = new Solution();
            Method method = null;

            // Find the method with the given name
            for (Method m : solution.getClass().getMethods()) {
                if (m.getName().equals(functionName)) {
                    method = m;
                    break;
                }
            }

            if (method == null) {
                System.err.println("Method not found: " + functionName);
                return;
            }

            // Dynamically determine parameter types
            Class<?>[] paramTypes = method.getParameterTypes();
            Object[] params = new Object[paramTypes.length];
            Map<String, Object> inputMap = gson.fromJson(jsonInput, new TypeToken<Map<String, Object>>() {}.getType());

            // Get parameter names from the method signature if available (requires -parameters flag during compilation)
            java.lang.reflect.Parameter[] methodParameters = method.getParameters();

            for (int i = 0; i < paramTypes.length; i++) {
                String paramName = methodParameters[i].getName();
                Object value = inputMap.get(paramName);

                if (paramTypes[i] == int.class) {
                    params[i] = ((Double) value).intValue();
                } else if (paramTypes[i] == int[].class) {
                    List<Double> list = (List<Double>) value;
                    params[i] = list.stream().mapToInt(Double::intValue).toArray();
                } else if (paramTypes[i] == String.class) {
                    params[i] = value;
                } else if (paramTypes[i] == String[].class) {
                    List<String> list = (List<String>) value;
                    params[i] = list.toArray(new String[0]);
                } else {
                    // Add more type conversions as needed
                    params[i] = gson.fromJson(gson.toJson(value), paramTypes[i]);
                }
            }

            Object result = method.invoke(solution, params);
            System.out.println(gson.toJson(result));

        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
