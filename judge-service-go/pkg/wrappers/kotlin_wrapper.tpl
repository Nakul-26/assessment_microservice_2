import com.google.gson.Gson
import com.google.gson.JsonArray
import com.google.gson.JsonNull
import com.google.gson.JsonObject
import java.lang.reflect.InvocationTargetException
import java.lang.reflect.Method
import java.lang.reflect.Modifier
import java.util.Base64

// Note: only number / string / boolean / array<...> / matrix<...> parameter and
// return types are supported for Kotlin. linkedlist/tree/graph are not supported.

private val GSON = Gson()

fun main(args: Array<String>) {
    try {
        if (args.isEmpty()) {
            System.err.println("{\"error\": \"missing input payload\"}")
            return
        }

        val decoded = String(Base64.getDecoder().decode(args[0]), Charsets.UTF_8)
        val payload = GSON.fromJson(decoded, JsonObject::class.java)
        val inputs: JsonArray? = if (payload != null && payload.has("inputs")) payload.getAsJsonArray("inputs") else null

        val funcName = "{{FUNCTION_NAME}}"
        val argCount = inputs?.size() ?: 0

        val solutionClass = Class.forName("Solution")
        val method: Method = solutionClass.declaredMethods.firstOrNull {
            it.name == funcName && it.parameterCount == argCount
        } ?: throw NoSuchMethodException("method $funcName with $argCount arguments not found")
        method.isAccessible = true

        val paramTypes = method.genericParameterTypes
        val argsValues = arrayOfNulls<Any>(paramTypes.size)
        for (i in paramTypes.indices) {
            val el = if (inputs != null && i < inputs.size()) inputs.get(i) else JsonNull.INSTANCE
            argsValues[i] = GSON.fromJson(el, paramTypes[i])
        }

        val instance: Any? = if (Modifier.isStatic(method.modifiers)) {
            null
        } else {
            solutionClass.getDeclaredConstructor().newInstance()
        }

        val output: Any?
        try {
            output = method.invoke(instance, *argsValues)
        } catch (e: InvocationTargetException) {
            System.err.println(errorPayload(e.cause ?: e))
            return
        }

        val result = JsonObject()
        if (method.returnType == java.lang.Void.TYPE && argsValues.isNotEmpty()) {
            result.add("output", GSON.toJsonTree(argsValues[0]))
        } else {
            result.add("output", GSON.toJsonTree(output))
        }
        System.err.println(GSON.toJson(result))
    } catch (e: Throwable) {
        System.err.println(errorPayload(e))
    }
}

private fun errorPayload(err: Throwable): String {
    val result = JsonObject()
    result.addProperty("error", err.javaClass.simpleName)
    result.addProperty("traceback", err.stackTraceToString())
    return GSON.toJson(result)
}
