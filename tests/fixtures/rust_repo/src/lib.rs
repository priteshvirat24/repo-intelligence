pub trait Tokenizer {
    fn count_tokens(&self, text: &str) -> usize;
}

pub struct ChunkEngine {
    pub max_tokens: usize,
}

impl ChunkEngine {
    pub fn new(max: usize) -> Self {
        ChunkEngine { max_tokens: max }
    }

    pub fn split(&self, text: &str) -> Vec<String> {
        vec![text.to_string()]
    }
}
