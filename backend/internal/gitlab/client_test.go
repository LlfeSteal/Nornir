package gitlab

import "testing"

func TestSubgroupOf(t *testing.T) {
	group := func(path string) *NamespaceRef { return &NamespaceRef{ID: "gid://gitlab/Group/1", FullPath: path} }
	project := func(path string) *NamespaceRef {
		return &NamespaceRef{ID: "gid://gitlab/Namespaces::ProjectNamespace/2", FullPath: path}
	}
	cases := []struct {
		name      string
		namespace *NamespaceRef
		want      string
	}{
		{"epic of the group", group("org/team"), ""},
		{"project of the group", project("org/team/app"), ""},
		{"epic of a subgroup", group("org/team/backend"), "backend"},
		{"project of a subgroup", project("org/team/backend/api"), "backend"},
		{"project of a nested subgroup", project("org/team/backend/core/api"), "backend/core"},
		{"path in another case", group("Org/Team/Backend"), "Backend"},
		{"outside the group", group("org/other"), ""},
		{"sibling with the same prefix", group("org/team-b/x"), ""},
		{"no namespace", nil, ""},
	}
	for _, c := range cases {
		if got := subgroupOf(c.namespace, "org/team"); got != c.want {
			t.Errorf("%s: subgroupOf = %q, want %q", c.name, got, c.want)
		}
	}
}
