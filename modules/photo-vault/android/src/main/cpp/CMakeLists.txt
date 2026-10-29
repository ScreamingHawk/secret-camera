cmake_minimum_required(VERSION 3.22.1)
project(photo_vault LANGUAGES C CXX)

add_library(photo_vault SHARED exclusive_publish.cpp)
target_compile_features(photo_vault PRIVATE cxx_std_17)
target_compile_options(photo_vault PRIVATE -Wall -Wextra -Werror)
