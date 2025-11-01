import java.io.File;
import java.io.FileNotFoundException;
import java.util.ArrayList;
import java.util.List;
import java.util.Scanner;
import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonParser;

public class {{CLASS_NAME}} {

    // USER_CODE_MARKER

    public static void main(String[] args) {
        List<TestResult> results = new ArrayList<>();
        Gson gson = new Gson();

        		String testsJsonString = "{{TESTS_JSON}}";
        		JsonArray testCasesArray = JsonParser.parseString(testsJsonString).getAsJsonArray();
        
        		for (int i = 0; i < testCasesArray.size(); i++) {
        			JsonElement testCaseElement = testCasesArray.get(i);
        			JsonArray inputArgs = testCaseElement.getAsJsonObject().getAsJsonArray("input");
        			JsonElement expectedOutputElement = testCaseElement.getAsJsonObject().get("expectedOutput");
        
        			try {
        				t// Placeholder for the dynamically generated function call
        				Object output = {{FUNCTION_CALL_LINE}};
        				boolean ok = gson.toJson(output).equals(gson.toJson(expectedOutputElement));
        				results.add(new TestResult(i + 1, ok, output, null));
        			} catch (Exception e) {
        				results.add(new TestResult(i + 1, false, null, e.toString()));
        			}
        		}
        Summary summary = new Summary("finished", results);
        System.out.println(gson.toJson(summary));
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
    }
}
