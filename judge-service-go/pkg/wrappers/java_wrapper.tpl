import java.util.ArrayList;
import java.util.List;

// USER_CODE_MARKER

public class {{.CLASS_NAME}} {

    public static void main(String[] args) {
        List<TestResult> results = new ArrayList<>();
        // Assuming the user's code defines a class named by {{.CLASS_NAME}} and a method named by {{.FUNCTION_NAME}}
        // We instantiate the class and call the method dynamically.
        // This part needs to be adapted based on how the user's code is structured.
        // For now, let's assume the user's code is directly within this class or a static method.

        // For simplicity, let's assume the user's solution is a static method within this class
        // named {{.FUNCTION_NAME}}.
        
        for (int i = 0; i < args.length; i += 3) {
            try {
                int num1 = Integer.parseInt(args[i]);
                int num2 = Integer.parseInt(args[i+1]);
                int expected = Integer.parseInt(args[i+2]);
                
                // Dynamically call the function. This is a placeholder and needs actual reflection or a more robust approach.
                // For now, we'll keep the direct call but use the placeholder for the method name.
                int out = Solution.{{.FUNCTION_NAME}}(num1, num2);
                boolean ok = out == expected;
                results.add(new TestResult((i/3) + 1, ok, out, null));
            } catch (Exception e) {
                results.add(new TestResult((i/3) + 1, false, null, e.toString()));
            }
        }
        
        Summary summary = new Summary("finished", results);
        System.out.println(summary.toJson());
    }
    
    static class TestResult {
        int test;
        boolean ok;
        Object output;
        String error;

        TestResult(int test, boolean ok, Object output, String error) {
            this.test = test;
            this.ok = ok;
            this.output = output;
            this.error = error;
        }

        String toJson() {
            String outStr = output instanceof String ? "\"" + output + "\"" : String.valueOf(output);
            String errStr = error != null ? "\"" + error.replace("\"", "\\\"") + "\"" : "null";
            return String.format("{\"test\": %d, \"ok\": %b, \"output\": %s, \"error\": %s}", test, ok, outStr, errStr);
        }
    }
    
    static class Summary {
        String status;
        long passed;
        long total;
        List<TestResult> details;

        Summary(String status, List<TestResult> results) {
            this.status = status;
            this.details = results;
            this.total = results.size();
            this.passed = results.stream().filter(r -> r.ok).count();
        }

        String toJson() {
            StringBuilder detailsJson = new StringBuilder("[");
            for (int i = 0; i < details.size(); i++) {
                detailsJson.append(details.get(i).toJson());
                if (i < details.size() - 1) {
                    detailsJson.append(",");
                }
            }
            detailsJson.append("]");
            return String.format("{\"status\": \"%s\", \"passed\": %d, \"total\": %d, \"details\": %s}", status, passed, total, detailsJson.toString());
        }
    }
}
