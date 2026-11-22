require 'xcodeproj'

project_path, swift_path, config_path = ARGV
project = Xcodeproj::Project.new(project_path)
test = project.new_target(:ui_test_bundle, 'OceanDMGUITests', :osx, '14.0', nil, :swift)
test.source_build_phase.add_file_reference(project.main_group.new_file(swift_path))
test.resources_build_phase.add_file_reference(project.main_group.new_file(config_path))
test.build_configurations.each do |configuration|
  configuration.build_settings['GENERATE_INFOPLIST_FILE'] = 'YES'
  configuration.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'ai.ellmos.ci.ocean-dmg-ui-tests'
  configuration.build_settings['SWIFT_VERSION'] = '5.0'
  configuration.build_settings['CODE_SIGN_IDENTITY'] = '-'
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.configure_with_targets(test, test, launch_target: false)
scheme.save_as(project.path, 'OceanDMG', true)
