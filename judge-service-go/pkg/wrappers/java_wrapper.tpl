import java.util.*;
import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import com.google.gson.reflect.TypeToken;
import java.lang.reflect.Type;
import java.util.stream.Collectors;
import java.util.stream.StreamSupport;

{{USER_CODE}}

public class GeneratedTester {
    // Call the user-supplied function from class Solution
    // (Make sure the user's class is compiled along with this file.)
    public static Object invoke(int[] nums) {
        // call the provided function
        return Solution.sumOfEvenNumbers(nums);
    }

    private static String arrToString(int[] a) {
        if (a == null) return "null";
        StringBuilder sb = new StringBuilder();
        sb.append("[");
        for (int i = 0; i < a.length; i++) {
            if (i > 0) sb.append(",");
            sb.append(a[i]);
        }
        sb.append("]");
        return sb.toString();
    }

    public static void main(String[] args) {
        // --- START GENERATED TESTS ---
        {{TESTS_LITERAL}}
        {{EXPECTED_LITERAL}}
        // --- END GENERATED TESTS ---

        int passed = 0;
        List<Map<String,Object>> details = new ArrayList<>();
        for (int i = 0; i < tests.length; i++) {
            int[] input = tests[i];
            int out = (Integer) invoke(input);
            boolean ok = (out == expected[i]);
            if (ok) passed++;
            Map<String,Object> tc = new LinkedHashMap<>();
            tc.put("test", i+1);
            tc.put("ok", ok);
            tc.put("input", arrToString(input));
            tc.put("output", out);
            tc.put("expected", expected[i]);
            if (!ok) tc.put("diff", "Values differ: expected " + expected[i] + ", got " + out);
            details.add(tc);
        }

        // Print JSON-like summary (or format as your judge expects)
        Gson gson = new Gson();
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("status", "finished");
        summary.put("passed", passed);
        summary.put("total", tests.length);
        summary.put("details", details);
        System.out.println(gson.toJson(summary));
    }
}
