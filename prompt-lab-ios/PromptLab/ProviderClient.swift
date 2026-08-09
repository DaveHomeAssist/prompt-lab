import Foundation

protocol ProviderClient {
    var providerID: String { get }
    var modelID: String { get }
    var requiresAPIKey: Bool { get }

    func streamEnhance(
        request: EnhanceRequest,
        apiKey: String
    ) -> AsyncThrowingStream<String, Error>
}

enum ProviderError: LocalizedError, Equatable {
    case invalidEndpoint
    case invalidResponse
    case httpStatus(Int, String?)
    case malformedStream
    case remote(String)

    var errorDescription: String? {
        switch self {
        case .invalidEndpoint:
            "The Anthropic endpoint is invalid."
        case .invalidResponse:
            "Anthropic returned an invalid HTTP response."
        case let .httpStatus(code, detail):
            if let detail, !detail.isEmpty {
                "Anthropic returned HTTP \(code): \(detail)"
            } else {
                "Anthropic returned HTTP \(code)."
            }
        case .malformedStream:
            "Anthropic returned a malformed streaming event."
        case let .remote(message):
            message
        }
    }
}

struct AnthropicProviderClient: ProviderClient {
    let providerID = "anthropic"
    let modelID = "claude-sonnet-4-6"
    let requiresAPIKey = true

    private let endpoint: String
    private let session: URLSession

    init(
        session: URLSession = .shared,
        endpoint: String = "https://api.anthropic.com/v1/messages"
    ) {
        self.session = session
        self.endpoint = endpoint
    }

    func streamEnhance(
        request: EnhanceRequest,
        apiKey: String
    ) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            let producer = Task {
                do {
                    guard let endpointURL = URL(string: endpoint) else {
                        throw ProviderError.invalidEndpoint
                    }
                    var urlRequest = URLRequest(url: endpointURL)
                    urlRequest.httpMethod = "POST"
                    urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    urlRequest.setValue(apiKey, forHTTPHeaderField: "x-api-key")
                    urlRequest.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
                    urlRequest.httpBody = try JSONEncoder().encode(
                        AnthropicRequestBody(
                            model: modelID,
                            maxTokens: 4_096,
                            temperature: 0.4,
                            system: SystemPromptBuilder.build(mode: request.mode, tags: request.tags),
                            messages: [.init(role: "user", content: request.prompt)],
                            stream: true
                        )
                    )

                    let (bytes, response) = try await session.bytes(for: urlRequest)
                    guard let httpResponse = response as? HTTPURLResponse else {
                        throw ProviderError.invalidResponse
                    }
                    guard (200...299).contains(httpResponse.statusCode) else {
                        throw ProviderError.httpStatus(
                            httpResponse.statusCode,
                            await Self.failureDetail(from: bytes)
                        )
                    }

                    for try await line in bytes.lines {
                        try Task.checkCancellation()
                        guard line.hasPrefix("data:") else { continue }
                        let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
                        guard !payload.isEmpty, payload != "[DONE]" else { continue }
                        guard let data = payload.data(using: .utf8) else {
                            throw ProviderError.malformedStream
                        }

                        let event: AnthropicStreamEvent
                        do {
                            event = try JSONDecoder().decode(AnthropicStreamEvent.self, from: data)
                        } catch {
                            throw ProviderError.malformedStream
                        }

                        if event.type == "error" {
                            throw ProviderError.remote(event.error?.message ?? "Anthropic streaming request failed.")
                        }
                        if event.type == "content_block_delta", let text = event.delta?.text, !text.isEmpty {
                            continuation.yield(text)
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }

            continuation.onTermination = { _ in
                producer.cancel()
            }
        }
    }

    /// Drains an error response so the caller sees Anthropic's own reason
    /// (invalid key, rate limit, overloaded) instead of a bare status code.
    /// Bounded so a large or malformed body cannot stall the request.
    private static func failureDetail(from bytes: URLSession.AsyncBytes) async -> String? {
        var data = Data()
        do {
            for try await byte in bytes {
                data.append(byte)
                if data.count >= 8_192 { break }
            }
        } catch {
            return nil
        }
        guard !data.isEmpty else { return nil }
        if let envelope = try? JSONDecoder().decode(AnthropicErrorEnvelope.self, from: data) {
            return envelope.error.message
        }
        let raw = String(data: data, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return (raw?.isEmpty ?? true) ? nil : raw
    }
}

private struct AnthropicErrorEnvelope: Decodable {
    let error: APIError

    struct APIError: Decodable {
        let type: String?
        let message: String
    }
}

#if DEBUG
struct RecordedAnthropicProviderClient: ProviderClient {
    let providerID = "anthropic"
    let modelID = "recorded-claude-sonnet-4-6"
    let requiresAPIKey = false

    func streamEnhance(
        request: EnhanceRequest,
        apiKey: String
    ) -> AsyncThrowingStream<String, Error> {
        let payload = """
        {"enhanced":"You are an expert product strategist. Analyze the supplied feature idea, identify the user problem, define a focused v1 scope, and return a concise recommendation with success criteria.","variants":[{"label":"Execution brief","content":"Turn the supplied feature idea into an execution brief with: user problem, v1 scope, exclusions, risks, and three measurable acceptance criteria."},{"label":"Decision memo","content":"Evaluate the supplied feature idea as a product decision. Return the strongest case for it, the strongest case against it, the smallest useful version, and a go/no-go recommendation."}],"notes":"Added a clear role, explicit analysis tasks, bounded output structure, and measurable success criteria while preserving the original product-analysis intent.","assumptions":["The desired output is a product recommendation rather than implementation code."],"tags":["Analysis","Creative"]}
        """
        let chunks = payload.chunked(maxLength: 47)

        return AsyncThrowingStream { continuation in
            let producer = Task {
                do {
                    for chunk in chunks {
                        try Task.checkCancellation()
                        try await Task.sleep(for: .milliseconds(15))
                        continuation.yield(chunk)
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in producer.cancel() }
        }
    }
}
#endif

private struct AnthropicRequestBody: Encodable {
    let model: String
    let maxTokens: Int
    let temperature: Double
    let system: String
    let messages: [Message]
    let stream: Bool

    struct Message: Encodable {
        let role: String
        let content: String
    }

    enum CodingKeys: String, CodingKey {
        case model
        case maxTokens = "max_tokens"
        case temperature
        case system
        case messages
        case stream
    }
}

private struct AnthropicStreamEvent: Decodable {
    let type: String
    let delta: Delta?
    let error: APIError?

    struct Delta: Decodable {
        let type: String?
        let text: String?
    }

    struct APIError: Decodable {
        let type: String?
        let message: String
    }
}

#if DEBUG
private extension String {
    func chunked(maxLength: Int) -> [String] {
        guard maxLength > 0 else { return [self] }
        var chunks: [String] = []
        var cursor = startIndex
        while cursor < endIndex {
            let end = index(cursor, offsetBy: maxLength, limitedBy: endIndex) ?? endIndex
            chunks.append(String(self[cursor..<end]))
            cursor = end
        }
        return chunks
    }
}
#endif
