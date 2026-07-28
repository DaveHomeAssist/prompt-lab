import Foundation

enum EnhanceMode: String, CaseIterable, Identifiable {
    case balanced
    case claude
    case chatgpt
    case image
    case code
    case concise
    case detailed

    var id: String { rawValue }

    var label: String {
        switch self {
        case .balanced: "Balanced"
        case .claude: "Claude"
        case .chatgpt: "ChatGPT"
        case .image: "Image Gen"
        case .code: "Code Gen"
        case .concise: "Concise"
        case .detailed: "Detailed"
        }
    }

    fileprivate var instruction: String {
        switch self {
        case .balanced:
            "Improve clarity and specificity. Add role, task, format, or constraints only when genuinely absent and needed for execution. Prefer minimal changes over aggressive restructuring. If the prompt is already clear, make only light adjustments."
        case .claude:
            "Optimize for Anthropic Claude models. Use XML tags (<instructions>, <context>, <output>) to structure the prompt where helpful. Make the output format explicit. Use direct, clear instructions. Avoid system-message tricks that only work on other models."
        case .chatgpt:
            "Optimize for OpenAI GPT-4/o models. Use system/user message structure idioms. Add chain-of-thought prompting (\"think step by step\") where it improves accuracy. Use JSON output format where appropriate. Avoid XML tags."
        case .image:
            "Optimize for image generation models (DALL-E, Midjourney, Stable Diffusion). Add style, artistic medium, lighting, composition, camera angle, aspect ratio, and quality modifiers where missing. Keep the subject description faithful to the user's intent. Do not change what the user wants to see — only improve how it is described for the model."
        case .code:
            "Optimize for code generation. Specify language, framework, and runtime where inferrable. Clarify input/output types, error handling expectations, and coding style. Add edge case notes only when they are likely to cause bugs. Do not add requirements the user did not ask for."
        case .concise:
            "Make the prompt as short and direct as possible. Remove filler words, redundant instructions, and unnecessary politeness. Preserve all intent, meaning, and constraints exactly. Do not add anything new. The goal is compression, not expansion."
        case .detailed:
            "Expand the prompt with richer context, concrete examples, explicit edge cases, and clear constraints. Ground every addition in what the user actually asked for — do not introduce new goals, audiences, or requirements. The expansion should make the existing intent more executable, not change the intent."
        }
    }
}

struct EnhanceRequest: Equatable {
    let prompt: String
    let mode: EnhanceMode
    let tags: [String]

    init(prompt: String, mode: EnhanceMode, tags: [String] = SystemPromptBuilder.availableTags) {
        self.prompt = prompt
        self.mode = mode
        self.tags = tags
    }
}

enum SystemPromptBuilder {
    static let availableTags = [
        "Writing", "Code", "Research", "Analysis", "Creative", "System", "Role-play", "Other",
    ]

    private static let intentPolicy = "Preserve the user's original intent, subject, and scope exactly. Do not invent or assume a medium (email, blog, Notion, etc.), audience, or tone the user did not specify. If the prompt uses contextual references like \"the\", \"this\", or \"that\", keep them — do not replace with placeholders. Only add structure the prompt genuinely lacks. Shorter prompts are not automatically worse."

    static func build(mode: EnhanceMode, tags: [String]) -> String {
        """
        You are an expert prompt engineer. \(intentPolicy) \(mode.instruction)
        Return ONLY valid JSON, no markdown, no backticks:
        {"enhanced":"...","variants":[{"label":"...","content":"..."}],"notes":"...","assumptions":["..."],"tags":["..."]}
        Produce 2 variants. In "notes", explain what you changed and why. In "assumptions", list anything you added that was not explicitly stated in the original prompt (medium, audience, tone, structure, constraints). If you added nothing, return an empty array. Available tags: \(tags.joined(separator: ", ")).
        """
    }
}

struct PromptVariant: Codable, Equatable, Hashable {
    let label: String
    let content: String
}

struct EnhanceResponse: Codable, Equatable {
    let enhanced: String
    let variants: [PromptVariant]
    let notes: String
    let assumptions: [String]
    let tags: [String]
}

enum EnhanceContractError: LocalizedError, Equatable {
    case invalidJSON
    case emptyEnhanced
    case invalidVariantCount(Int)
    case emptyVariant(Int)
    case emptyNotes

    var errorDescription: String? {
        switch self {
        case .invalidJSON:
            "The model response did not match the enhance JSON contract."
        case .emptyEnhanced:
            "The enhance response contained an empty enhanced prompt."
        case let .invalidVariantCount(count):
            "The enhance response contained \(count) variants; exactly 2 are required."
        case let .emptyVariant(index):
            "Enhance variant \(index + 1) is missing its label or content."
        case .emptyNotes:
            "The enhance response did not explain its changes in notes."
        }
    }
}

enum EnhanceResponseParser {
    static func parse(_ text: String) throws -> EnhanceResponse {
        guard let data = text.data(using: .utf8) else {
            throw EnhanceContractError.invalidJSON
        }

        let response: EnhanceResponse
        do {
            response = try JSONDecoder().decode(EnhanceResponse.self, from: data)
        } catch {
            throw EnhanceContractError.invalidJSON
        }

        guard !response.enhanced.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw EnhanceContractError.emptyEnhanced
        }
        guard response.variants.count == 2 else {
            throw EnhanceContractError.invalidVariantCount(response.variants.count)
        }
        for (index, variant) in response.variants.enumerated() {
            guard !variant.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  !variant.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw EnhanceContractError.emptyVariant(index)
            }
        }
        guard !response.notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw EnhanceContractError.emptyNotes
        }
        return response
    }
}
