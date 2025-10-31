import java.io.File;
import java.io.FileNotFoundException;
import java.util.ArrayList;
import java.util.List;
import java.util.Scanner;
import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonParser;

public class Main {

    // USER_CODE_MARKER

    public static void main(String[] args) {
        List<TestResult> results = new ArrayList<>();
        Gson gson = new Gson();

        try {
            File inputFile = new File("input.txt");
            Scanner scanner = new Scanner(inputFile);
            int testNum = 1;
            while (scanner.hasNextLine()) {
                String line = scanner.nextLine();
                if (line.trim().isEmpty()) continue;

                try {
                    JsonElement testCaseElement = JsonParser.parseString(line);
                    JsonArray inputArgs = testCaseElement.getAsJsonObject().getAsJsonArray("input");
                    JsonElement expectedOutputElement = testCaseElement.getAsJsonObject().get("expectedOutput");

                    // Assuming the user's code is in a class named Solution and has a static method {{FUNCTION_NAME}}
                    // We will call the user's method directly from here
                    int[] input = gson.fromJson(inputArgs, int[].class);
                    Object output = Solution.{{FUNCTION_NAME}}(input[0], input[1]);
                    boolean ok = gson.toJson(output).equals(gson.toJson(expectedOutputElement));
                    results.add(new TestResult(testNum++, ok, output, null));
                } catch (Exception e) {
                    results.add(new TestResult(testNum++, false, null, e.toString()));
                }
            }
            scanner.close();
        } catch (FileNotFoundException e) {
            results.add(new TestResult(1, false, null, "input.txt not found"));
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
