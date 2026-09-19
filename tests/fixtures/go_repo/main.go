package main

type Indexer interface {
	Index(id string, vector []float32) error
}

type VectorStore struct {
	Dimensions int
}

func (vs *VectorStore) Index(id string, vector []float32) error {
	return nil
}

func NewVectorStore(dims int) *VectorStore {
	return &VectorStore{Dimensions: dims}
}
