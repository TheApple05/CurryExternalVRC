use crate::state::valid_id;
use serde_json::{json, Value};

pub fn normalize(payload: Value) -> Result<Value, String> {
    let records = payload
        .as_array()
        .or_else(|| {
            ["avatars", "items", "data", "results"]
                .iter()
                .find_map(|k| payload.get(k)?.as_array())
        })
        .ok_or("Unexpected catalog response")?;
    let avatars: Vec<Value> = records
        .iter()
        .take(100)
        .filter_map(|record| {
            if record.get("explicit") == Some(&Value::Bool(true)) {
                return None;
            }
            let id = ["vrc_id", "id", "avatar_id"]
                .iter()
                .find_map(|key| record.get(key)?.as_str())?;
            if !valid_id(id, "avtr_") {
                return None;
            }
            let name = ["name", "title"]
                .iter()
                .find_map(|key| record.get(key)?.as_str())
                .unwrap_or(id);
            let author = record
                .pointer("/author/name")
                .and_then(Value::as_str)
                .or_else(|| record.get("author_name")?.as_str())
                .or_else(|| record.get("authorName")?.as_str())
                .unwrap_or("Unknown creator");
            let image = [
                "image_url",
                "imageUrl",
                "thumbnail_url",
                "thumbnailImageUrl",
            ]
            .iter()
            .find_map(|key| record.get(key)?.as_str())
            .or_else(|| record.pointer("/image/thumb")?.as_str())
            .or_else(|| record.pointer("/image/url")?.as_str())
            .unwrap_or("");
            let image = url::Url::parse(image)
                .ok()
                .filter(|url| {
                    url.scheme() == "https"
                        && url.host_str() == Some("thumb.avtrdb.com")
                        && url.username().is_empty()
                        && url.password().is_none()
                        && url.port().is_none()
                })
                .map(|url| url.to_string())
                .unwrap_or_default();
            let platforms: Vec<_> = record
                .get("compatibility")
                .or_else(|| record.get("platforms"))
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .take(8)
                .collect();
            Some(
                json!({"vrc_id":id, "name":name.chars().take(128).collect::<String>(),
            "author":{"name":author.chars().take(128).collect::<String>()},
            "image_url":image, "compatibility":platforms}),
            )
        })
        .collect();
    let has_more = payload
        .get("has_more")
        .or_else(|| payload.get("hasMore"))
        .or_else(|| payload.pointer("/pagination/has_more"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    Ok(json!({"avatars":avatars, "has_more":has_more}))
}

pub async fn search(client: &reqwest::Client, query: &str, page: u32) -> Result<Value, String> {
    if query.chars().count() > 200 || page > 10000 {
        return Err("Search input is too long.".into());
    }
    let endpoint = if query.is_empty() { "random" } else { "search" };
    let mut request = client
        .get(format!("https://api.avtrdb.com/v2/avatar/{endpoint}"))
        .query(&[("page_size", "14")]);
    if !query.is_empty() {
        request = request.query(&[("query", query), ("page", &page.to_string())]);
    }
    let mut response = request
        .send()
        .await
        .map_err(|e| format!("Catalog request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Catalog request failed: {e}"))?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
            return Err("Catalog response exceeds 2 MB.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    normalize(serde_json::from_slice(&bytes).map_err(|e| format!("Invalid catalog JSON: {e}"))?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelopes_filtering_and_untrusted_fields() {
        for key in ["avatars", "items", "data", "results"] {
            let payload = json!({key:[{"id":"avtr_good","title":"Test","platforms":["pc",null],
                "image_url":"https://evil.example/pic"}, {"id":"avtr_hidden","explicit":true},
                {"id":"wrld_wrong"}, null],"pagination":{"has_more":true}});
            let result = normalize(payload).unwrap();
            assert_eq!(result["avatars"].as_array().unwrap().len(), 1);
            assert_eq!(result["avatars"][0]["image_url"], "");
            assert_eq!(result["avatars"][0]["compatibility"], json!(["pc"]));
            assert_eq!(result["has_more"], true);
        }
        assert!(normalize(json!({"error":"bad"})).is_err());
        assert_eq!(normalize(json!([])).unwrap()["avatars"], json!([]));
    }
}
